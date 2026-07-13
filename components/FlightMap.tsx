"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  StyleSpecification,
} from "maplibre-gl";

type Airport = { name: string; city: string; country: string; lat: number; lon: number };
type FlightData = { airports: Record<string, Airport>; adj: Record<string, string[]> };

type Readout = {
  code: string;
  name: string;
  sub: string;
  dests: number;
  countries: number;
  furthest: { name: string; country: string; km: number } | null;
};

type RoutePath = { codes: string[]; km: number };
type RouteInfo = {
  from: string;
  to: string;
  paths: RoutePath[];
  sel: number;
} | null;

const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Plain night ground used until tiles arrive, or if the tile CDN is down —
// the route layers work either way.
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0a0f1d" } }],
};

function haversineKm(a: Airport, b: Airport): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Great-circle arc between two airports as [lon,lat] points, antimeridian-safe. */
function gcArc(a: Airport, b: Airport, steps = 48): [number, number][] {
  const toR = Math.PI / 180, toD = 180 / Math.PI;
  const p1 = [a.lat * toR, a.lon * toR], p2 = [b.lat * toR, b.lon * toR];
  const v1 = [Math.cos(p1[0]) * Math.cos(p1[1]), Math.cos(p1[0]) * Math.sin(p1[1]), Math.sin(p1[0])];
  const v2 = [Math.cos(p2[0]) * Math.cos(p2[1]), Math.cos(p2[0]) * Math.sin(p2[1]), Math.sin(p2[0])];
  const dot = Math.min(1, Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  const w = Math.acos(dot);
  const pts: [number, number][] = [];
  if (w < 1e-6) return [[a.lon, a.lat], [b.lon, b.lat]];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s1 = Math.sin((1 - t) * w) / Math.sin(w);
    const s2 = Math.sin(t * w) / Math.sin(w);
    const x = s1 * v1[0] + s2 * v2[0];
    const y = s1 * v1[1] + s2 * v2[1];
    const z = s1 * v1[2] + s2 * v2[2];
    pts.push([Math.atan2(y, x) * toD, Math.asin(z / Math.hypot(x, y, z)) * toD]);
  }
  // unwrap longitudes so lines don't jump across the antimeridian
  for (let i = 1; i < pts.length; i++) {
    let d = pts[i][0] - pts[i - 1][0];
    if (d > 180) pts[i][0] -= 360;
    else if (d < -180) pts[i][0] += 360;
  }
  return pts;
}

/** All fewest-hop paths from src to dst (BFS with parent tracking). */
function shortestPaths(
  src: string,
  dst: string,
  adj: Record<string, string[]>,
): string[][] | null {
  if (src === dst) return null;
  const dist: Record<string, number> = { [src]: 0 };
  const parents: Record<string, string[]> = {};
  let frontier = [src];
  let found = dst in dist;
  let depth = 0;
  while (frontier.length && !found && depth < 6) {
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of adj[u] ?? []) {
        if (!(v in dist)) {
          dist[v] = dist[u] + 1;
          parents[v] = [u];
          next.push(v);
        } else if (dist[v] === dist[u] + 1) {
          parents[v].push(u);
        }
      }
    }
    depth++;
    if (dst in dist) found = true;
    frontier = next;
  }
  if (!(dst in dist)) return null;

  const paths: string[][] = [];
  const stack: string[][] = [[dst]];
  while (stack.length && paths.length < 60) {
    const p = stack.pop()!;
    const head = p[0];
    if (head === src) {
      paths.push(p);
      continue;
    }
    for (const par of parents[head] ?? []) stack.push([par, ...p]);
  }
  return paths;
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

export default function FlightMap({ initial = "DUS" }: { initial?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReady = useRef(false);
  const dataRef = useRef<FlightData | null>(null);
  const reduceRef = useRef(false);

  const [readout, setReadout] = useState<Readout | null>(null);
  const [route, setRoute] = useState<RouteInfo>(null);
  const [noRoute, setNoRoute] = useState<{ from: string; to: string } | null>(null);

  const [fromQ, setFromQ] = useState("");
  const [toQ, setToQ] = useState("");
  const fromCode = useRef<string | null>(null);
  const toCode = useRef<string | null>(null);
  const [hits, setHits] = useState<{ which: "from" | "to"; codes: string[] } | null>(null);
  const [actIdx, setActIdx] = useState(-1);
  const [tip, setTip] = useState<{ x: number; y: number; code: string; name: string; routes: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const setData = (id: string, d: GeoJSON.FeatureCollection) => {
    const src = mapRef.current?.getSource(id) as GeoJSONSource | undefined;
    src?.setData(d);
  };

  const panelPadding = () => {
    const mobile = typeof window !== "undefined" && window.innerWidth < 720;
    return mobile
      ? { top: 60, bottom: 240, left: 40, right: 40 }
      : { top: 90, bottom: 90, left: 430, right: 90 };
  };

  // ---- explore mode: fan out all direct routes from an origin ----
  const select = useCallback((code: string) => {
    const data = dataRef.current;
    const map = mapRef.current;
    if (!data || !map || !mapReady.current || !data.adj[code]) return;

    setRoute(null);
    setNoRoute(null);

    const o = data.airports[code];
    const dests = data.adj[code] ?? [];
    const countries = new Set<string>();
    let far: Airport | null = null;
    let farKm = 0;

    const arcFeatures: GeoJSON.Feature[] = [];
    const destFeatures: GeoJSON.Feature[] = [];
    for (const d of dests) {
      const dd = data.airports[d];
      if (!dd) continue;
      countries.add(dd.country);
      const km = haversineKm(o, dd);
      if (km > farKm) { farKm = km; far = dd; }
      arcFeatures.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: gcArc(o, dd) },
      });
      destFeatures.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [dd.lon, dd.lat] },
      });
    }

    setData("fan-arcs", fc(arcFeatures));
    setData("dest-dots", fc(destFeatures));
    setData("route-main", fc([]));
    setData("route-alts", fc([]));
    setData("route-stops", fc([]));
    setData("origin-dot", fc([{
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [o.lon, o.lat] },
    }]));

    map.flyTo({
      center: [o.lon, o.lat],
      zoom: Math.max(map.getZoom(), 2.4),
      animate: !reduceRef.current,
    });

    setReadout({
      code,
      name: o.name,
      sub: (o.city ? o.city + ", " : "") + o.country,
      dests: dests.length,
      countries: countries.size,
      furthest: far ? { name: far.name, country: far.country, km: Math.round(farKm) } : null,
    });
  }, []);

  // ---- A -> B route mode ----
  const drawRoutePaths = useCallback((paths: RoutePath[], sel: number) => {
    const data = dataRef.current;
    const map = mapRef.current;
    if (!data || !map) return;
    const apt = (c: string) => data.airports[c];

    const line = (codes: string[]): GeoJSON.Feature => {
      const coords: [number, number][] = [];
      for (let i = 0; i < codes.length - 1; i++) {
        const seg = gcArc(apt(codes[i]), apt(codes[i + 1]));
        coords.push(...(i === 0 ? seg : seg.slice(1)));
      }
      return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
    };

    const main = paths[sel];
    setData("route-main", fc([line(main.codes)]));
    setData("route-alts", fc(paths.filter((_, i) => i !== sel).map((p) => line(p.codes))));
    setData("route-stops", fc(main.codes.map((c, i) => ({
      type: "Feature",
      properties: { end: i === 0 || i === main.codes.length - 1 ? 1 : 0 },
      geometry: { type: "Point", coordinates: [apt(c).lon, apt(c).lat] },
    }))));
    setData("fan-arcs", fc([]));
    setData("dest-dots", fc([]));
    setData("origin-dot", fc([]));

    const b = new maplibregl.LngLatBounds();
    for (const c of main.codes) b.extend([apt(c).lon, apt(c).lat]);
    map.fitBounds(b, { padding: panelPadding(), animate: !reduceRef.current, maxZoom: 6 });
  }, []);

  const computeRoute = useCallback((from: string, to: string) => {
    const data = dataRef.current;
    if (!data || !mapReady.current) return;
    const raw = shortestPaths(from, to, data.adj);
    setReadout(null);

    if (!raw || raw.length === 0) {
      setRoute(null);
      setNoRoute({ from, to });
      setData("route-main", fc([]));
      setData("route-alts", fc([]));
      setData("route-stops", fc([]));
      setData("fan-arcs", fc([]));
      setData("dest-dots", fc([]));
      return;
    }

    const scored: RoutePath[] = raw
      .map((codes) => {
        let km = 0;
        for (let i = 0; i < codes.length - 1; i++) {
          const a = data.airports[codes[i]], b = data.airports[codes[i + 1]];
          if (a && b) km += haversineKm(a, b);
        }
        return { codes, km: Math.round(km) };
      })
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);

    setNoRoute(null);
    setRoute({ from, to, paths: scored, sel: 0 });
    drawRoutePaths(scored, 0);
  }, [drawRoutePaths]);

  const selectRouteOption = (idx: number) => {
    setRoute((r) => {
      if (!r) return r;
      drawRoutePaths(r.paths, idx);
      return { ...r, sel: idx };
    });
  };

  // ---- picking airports into the from/to slots ----
  const label = (code: string) => {
    const a = dataRef.current?.airports[code];
    return a ? `${a.name} (${code})` : code;
  };

  const applySelection = useCallback(() => {
    const f = fromCode.current, t = toCode.current;
    if (f && t && f !== t) computeRoute(f, t);
    else if (f) select(f);
  }, [computeRoute, select]);

  const pick = useCallback((code: string, which: "from" | "to") => {
    if (which === "from") {
      fromCode.current = code;
      setFromQ(label(code));
    } else {
      toCode.current = code;
      setToQ(label(code));
    }
    setHits(null);
    setActIdx(-1);
    applySelection();
  }, [applySelection]);

  const clearTo = () => {
    toCode.current = null;
    setToQ("");
    setRoute(null);
    setNoRoute(null);
    if (fromCode.current) select(fromCode.current);
  };

  const swap = () => {
    const f = fromCode.current, t = toCode.current;
    if (!t) return;
    fromCode.current = t;
    toCode.current = f;
    setFromQ(t ? label(t) : "");
    setToQ(f ? label(f) : "");
    applySelection();
  };

  // ---- boot: map + data ----
  useEffect(() => {
    reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!containerRef.current) return;

    let map: maplibregl.Map | null = null;
    let alive = true;

    const addLayers = () => {
      const m = map;
      if (!m) return;
      const empty = fc([]);
      const gradient = [
        "interpolate", ["linear"], ["line-progress"],
        0, "rgba(79,227,255,.9)",
        0.5, "rgba(255,207,107,.9)",
        1, "rgba(255,138,61,.75)",
      ] as unknown as ExpressionSpecification;

      const data = dataRef.current;
      if (data && !m.getSource("airports")) {
        m.addSource("airports", {
          type: "geojson",
          data: fc(Object.entries(data.airports).map(([code, a]) => ({
            type: "Feature",
            properties: { code, name: a.name, routes: data.adj[code]?.length ?? 0 },
            geometry: { type: "Point", coordinates: [a.lon, a.lat] },
          }))),
        });
        m.addLayer({
          id: "airport-dots",
          source: "airports",
          type: "circle",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.1, 4, 2.2, 8, 4],
            "circle-color": "rgba(126,158,208,.55)",
          },
        });
      }

      const geo = (id: string, lineMetrics = false) => {
        if (!m.getSource(id)) m.addSource(id, { type: "geojson", data: empty, lineMetrics });
      };
      geo("fan-arcs", true);
      geo("route-alts", true);
      geo("route-main", true);
      geo("dest-dots");
      geo("route-stops");
      geo("origin-dot");

      if (!m.getLayer("fan-arcs-l")) {
        m.addLayer({
          id: "fan-arcs-l", source: "fan-arcs", type: "line",
          paint: { "line-gradient": gradient, "line-width": 1, "line-opacity": 0.55 },
          layout: { "line-cap": "round" },
        });
        m.addLayer({
          id: "route-alts-l", source: "route-alts", type: "line",
          paint: { "line-gradient": gradient, "line-width": 1.2, "line-opacity": 0.2 },
        });
        m.addLayer({
          id: "route-main-l", source: "route-main", type: "line",
          paint: { "line-gradient": gradient, "line-width": 2.6, "line-opacity": 0.95 },
          layout: { "line-cap": "round" },
        });
        m.addLayer({
          id: "dest-dots-l", source: "dest-dots", type: "circle",
          paint: { "circle-radius": 2.4, "circle-color": "rgba(255,180,90,.95)" },
        });
        m.addLayer({
          id: "route-stops-l", source: "route-stops", type: "circle",
          paint: {
            "circle-radius": ["case", ["==", ["get", "end"], 1], 5, 3.5],
            "circle-color": ["case", ["==", ["get", "end"], 1], "#4fe3ff", "#ffcf6b"],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "rgba(7,11,22,.8)",
          },
        });
        m.addLayer({
          id: "origin-halo-l", source: "origin-dot", type: "circle",
          paint: { "circle-radius": 13, "circle-color": "rgba(79,227,255,.16)" },
        });
        m.addLayer({
          id: "origin-dot-l", source: "origin-dot", type: "circle",
          paint: { "circle-radius": 4.5, "circle-color": "#4fe3ff" },
        });
      }

      // hover + click on airport dots
      m.on("mousemove", "airport-dots", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        m.getCanvas().style.cursor = "pointer";
        setTip({
          x: e.point.x,
          y: e.point.y,
          code: f.properties.code as string,
          name: f.properties.name as string,
          routes: f.properties.routes as number,
        });
      });
      m.on("mouseleave", "airport-dots", () => {
        m.getCanvas().style.cursor = "";
        setTip(null);
      });
      m.on("click", "airport-dots", (e) => {
        const code = e.features?.[0]?.properties.code as string | undefined;
        if (!code || !dataRef.current) return;
        if (fromCode.current && !toCode.current && code !== fromCode.current) {
          pick(code, "to");
        } else if (dataRef.current.adj[code]) {
          toCode.current = null;
          setToQ("");
          pick(code, "from");
        }
      });
    };

    const boot = () => {
      if (mapReady.current || !dataRef.current) return;
      mapReady.current = true;
      map?.resize();
      addLayers();
      const qs = new URLSearchParams(window.location.search);
      const d = dataRef.current;
      const qFrom = (qs.get("from") ?? "").toUpperCase();
      const qTo = (qs.get("to") ?? "").toUpperCase();
      const start = d.adj[qFrom] ? qFrom : initial;
      fromCode.current = start;
      setFromQ(`${d.airports[start]?.name ?? start} (${start})`);
      if (qTo && d.airports[qTo] && qTo !== start) {
        toCode.current = qTo;
        setToQ(`${d.airports[qTo].name} (${qTo})`);
        computeRoute(start, qTo);
      } else {
        select(start);
      }
    };

    // Resolve style + data first, then create the map — no load-order races.
    const styleP: Promise<StyleSpecification | string> = fetch(BASEMAP_STYLE)
      .then((r) => (r.ok ? (r.json() as Promise<StyleSpecification>) : FALLBACK_STYLE))
      .catch(() => FALLBACK_STYLE);
    const dataP = fetch("/flight-data.json").then((r) => r.json() as Promise<FlightData>);

    Promise.all([styleP, dataP]).then(([style, d]) => {
      if (!alive || !containerRef.current) return;
      dataRef.current = d;
      setLoaded(true);
      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: [12, 38],
        zoom: 1.8,
        minZoom: 1,
        maxZoom: 11,
      });
      mapRef.current = map;
      (window as unknown as { __map?: maplibregl.Map }).__map = map;
      map.on("load", boot);
      // Container can be measured before styles settle — track its real size.
      ro = new ResizeObserver(() => mapRef.current?.resize());
      ro.observe(containerRef.current);
    });

    let ro: ResizeObserver | null = null;
    return () => {
      alive = false;
      ro?.disconnect();
      map?.remove();
      mapRef.current = null;
      mapReady.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- search ----
  const search = (term: string, which: "from" | "to") => {
    if (which === "from") setFromQ(term);
    else setToQ(term);
    const data = dataRef.current;
    const t = term.trim().toLowerCase();
    if (!data || !t) { setHits(null); return; }
    const scored: [number, string][] = [];
    const pool = which === "from" ? Object.keys(data.adj) : Object.keys(data.airports);
    for (const code of pool) {
      const a = data.airports[code];
      if (!a) continue;
      const c = code.toLowerCase();
      const city = (a.city || "").toLowerCase();
      const name = (a.name || "").toLowerCase();
      const country = (a.country || "").toLowerCase();
      let s = 99;
      if (c === t) s = 0;
      else if (c.startsWith(t)) s = 1;
      else if (city.startsWith(t)) s = 2;
      else if (name.startsWith(t)) s = 3;
      else if (country === t) s = 4;           // exact country -> list its airports
      else if (city.includes(t)) s = 5;
      else if (name.includes(t)) s = 6;
      else if (country.startsWith(t)) s = 7;   // partial country name
      if (s < 99) scored.push([s, code]);
    }
    scored.sort(
      (x, y) =>
        x[0] - y[0] ||
        (dataRef.current!.adj[y[1]]?.length ?? 0) - (dataRef.current!.adj[x[1]]?.length ?? 0),
    );
    setHits({ which, codes: scored.slice(0, 10).map((h) => h[1]) });
    setActIdx(-1);
  };

  const onKey = (e: React.KeyboardEvent, which: "from" | "to") => {
    if (!hits || hits.which !== which || !hits.codes.length) return;
    if (e.key === "ArrowDown") { setActIdx((i) => Math.min(hits.codes.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setActIdx((i) => Math.max(0, i - 1)); e.preventDefault(); }
    else if (e.key === "Enter") { pick(hits.codes[actIdx >= 0 ? actIdx : 0], which); e.preventDefault(); }
    else if (e.key === "Escape") setHits(null);
  };

  const surprise = () => {
    const data = dataRef.current;
    if (!data) return;
    const keys = Object.keys(data.adj);
    toCode.current = null;
    setToQ("");
    pick(keys[Math.floor(Math.random() * keys.length)], "from");
  };

  const biggestHub = () => {
    const data = dataRef.current;
    if (!data) return;
    let best = "", bn = 0;
    for (const k in data.adj) {
      if (data.adj[k].length > bn) { bn = data.adj[k].length; best = k; }
    }
    toCode.current = null;
    setToQ("");
    pick(best, "from");
  };

  const data = dataRef.current;
  const fmtPath = (codes: string[]) => codes.join(" → ");

  return (
    <div className="stage">
      <div ref={containerRef} className="mapbox" aria-label="World map of airports and direct flight routes" />

      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          <span className="t-code">{tip.code}</span> {tip.name}
          {tip.routes > 0 && ` · ${tip.routes} routes`}
        </div>
      )}

      <div className="panel hud">
        <p className="eyebrow"><span className="wordmark">TravelIntel</span></p>
        <h1>
          Where can you fly <span className="accent">non-stop?</span>
        </h1>
        <p className="sub">
          Pick an origin to fan out every direct route — or add a destination
          to find the best connections.
        </p>

        <div className="searchwrap">
          <div className="search">
            <span className="slot-label">From</span>
            <input
              type="text"
              value={fromQ}
              onChange={(e) => search(e.target.value, "from")}
              onKeyDown={(e) => onKey(e, "from")}
              onFocus={(e) => e.target.select()}
              placeholder={loaded ? "City or airport code…" : "Loading route data…"}
              autoComplete="off"
              spellCheck={false}
              aria-label="Origin airport"
            />
          </div>
          {hits && hits.which === "from" && hits.codes.length > 0 && data && (
            <div className="results" role="listbox">
              {hits.codes.map((c, i) => (
                <div
                  key={c}
                  role="option"
                  aria-selected={i === actIdx}
                  className={`hit${i === actIdx ? " active" : ""}`}
                  onClick={() => pick(c, "from")}
                >
                  <span className="code">{c}</span>
                  <span className="nm">
                    {data.airports[c].name}
                    <span className="loc">
                      {" · "}
                      {data.airports[c].city ? `${data.airports[c].city}, ` : ""}
                      {data.airports[c].country}
                    </span>
                  </span>
                  <span className="cc">{data.adj[c]?.length ?? 0} routes</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="searchwrap towrap">
          <div className="search">
            <span className="slot-label">To</span>
            <input
              type="text"
              value={toQ}
              onChange={(e) => search(e.target.value, "to")}
              onKeyDown={(e) => onKey(e, "to")}
              onFocus={(e) => e.target.select()}
              placeholder="Anywhere (optional)"
              autoComplete="off"
              spellCheck={false}
              aria-label="Destination airport"
            />
            {toQ && (
              <button className="mini" onClick={clearTo} aria-label="Clear destination">✕</button>
            )}
            <button className="mini" onClick={swap} aria-label="Swap origin and destination">⇅</button>
          </div>
          {hits && hits.which === "to" && hits.codes.length > 0 && data && (
            <div className="results" role="listbox">
              {hits.codes.map((c, i) => (
                <div
                  key={c}
                  role="option"
                  aria-selected={i === actIdx}
                  className={`hit${i === actIdx ? " active" : ""}`}
                  onClick={() => pick(c, "to")}
                >
                  <span className="code">{c}</span>
                  <span className="nm">
                    {data.airports[c].name}
                    <span className="loc">
                      {" · "}
                      {data.airports[c].city ? `${data.airports[c].city}, ` : ""}
                      {data.airports[c].country}
                    </span>
                  </span>
                  <span className="cc">{data.adj[c]?.length ?? 0} routes</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="actions">
          <button className="btn" onClick={surprise}>✦ Surprise me</button>
          <button className="btn" onClick={biggestHub}>◎ Biggest hub</button>
        </div>
      </div>

      {/* ---- explore readout ---- */}
      <div className={`panel readout${readout && !route && !noRoute ? " show" : ""}`}>
        {readout && (
          <>
            <p className="origin-name">
              {readout.name} · {readout.code}
            </p>
            <p className="origin-sub">{readout.sub}</p>
            <div className="stats">
              <div className="stat hi">
                <div className="k">{readout.dests}</div>
                <div className="l">direct destinations</div>
              </div>
              <div className="stat">
                <div className="k">{readout.countries}</div>
                <div className="l">countries reached</div>
              </div>
            </div>
            {readout.furthest && (
              <p className="far">
                Furthest non-stop: <b>{readout.furthest.name}</b> ({readout.furthest.country}) —{" "}
                {readout.furthest.km.toLocaleString("en-US")} km away.
              </p>
            )}
            <Link className="pagelink" href={`/airports/${readout.code.toLowerCase()}/`}>
              → Full {readout.code} route list
            </Link>
          </>
        )}
      </div>

      {/* ---- route readout ---- */}
      <div className={`panel readout${route || noRoute ? " show" : ""}`}>
        {noRoute && (
          <>
            <p className="origin-name">
              {noRoute.from} → {noRoute.to}
            </p>
            <p className="far">
              No flight path found between these airports in the network (up to
              5 stops). They may be in disconnected regions of the dataset.
            </p>
          </>
        )}
        {route && (
          <>
            <p className="origin-name">
              {route.from} → {route.to}
            </p>
            <p className="origin-sub">
              {route.paths[route.sel].codes.length === 2
                ? "Non-stop connection"
                : `Best: ${route.paths[route.sel].codes.length - 2} stop${route.paths[route.sel].codes.length > 3 ? "s" : ""} · ${route.paths.length} option${route.paths.length > 1 ? "s" : ""} shown`}
            </p>
            <div className="stats">
              <div className="stat hi">
                <div className="k">{route.paths[route.sel].codes.length - 1}</div>
                <div className="l">flight{route.paths[route.sel].codes.length > 2 ? "s" : ""}</div>
              </div>
              <div className="stat">
                <div className="k">{route.paths[route.sel].km.toLocaleString("en-US")}</div>
                <div className="l">total km (great-circle)</div>
              </div>
            </div>
            <div className="ropts">
              {route.paths.map((p, i) => (
                <div
                  key={p.codes.join("-")}
                  className={`ropt${i === route.sel ? " sel" : ""}`}
                  onClick={() => selectRouteOption(i)}
                >
                  <span className="path">{fmtPath(p.codes)}</span>
                  <span className="km">{p.km.toLocaleString("en-US")} km</span>
                </div>
              ))}
            </div>
            <p className="far small">
              Fewest-hop routes from the open route network. Carriers and
              schedules not included — verify times before booking.
            </p>
          </>
        )}
      </div>

      <div className="foot">
        <Link href="/airports/">all airports</Link> · routes: OpenFlights + OurAirports
      </div>
    </div>
  );
}
