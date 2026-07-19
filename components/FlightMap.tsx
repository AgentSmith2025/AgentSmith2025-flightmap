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

type ThemeName = "night" | "day";

const THEMES = {
  night: {
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    ground: "#0a0f1d",
    dots: "rgba(126,158,208,.55)",
    dest: "rgba(255,180,90,.95)",
    origin: "#4fe3ff",
    halo: "rgba(79,227,255,.16)",
    stop: "#ffcf6b",
    stopStroke: "rgba(7,11,22,.8)",
    drive: "#34d399",
    grad: ["rgba(79,227,255,.9)", "rgba(255,207,107,.9)", "rgba(255,138,61,.75)"],
  },
  day: {
    style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    ground: "#dfe6ee",
    dots: "rgba(71,94,128,.5)",
    dest: "rgba(217,88,18,.9)",
    origin: "#0284c7",
    halo: "rgba(2,132,199,.15)",
    stop: "#d97706",
    stopStroke: "rgba(255,255,255,.9)",
    drive: "#059669",
    grad: ["rgba(2,132,199,.9)", "rgba(202,110,10,.9)", "rgba(234,88,12,.85)"],
  },
} as const;

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const DRIVE_MAX_KM = 3500; // beyond this, don't even ask for a road route

type DriveInfo = {
  km: number;
  hours: number;
  stop: { city: string; country: string } | null;
};

const fmtH = (hours: number) => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h} h ${String(m).padStart(2, "0")} m`;
};

// Plain ground used if the tile CDN is unreachable — routes render either way.
const fallbackStyle = (ground: string): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": ground } }],
});

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
  const [theme, setTheme] = useState<ThemeName>("day");
  const themeRef = useRef<ThemeName>("day");
  const styleCache = useRef<Partial<Record<ThemeName, StyleSpecification>>>({});
  const addLayersRef = useRef<() => void>(() => {});
  const planeRef = useRef<{ marker: maplibregl.Marker | null; raf: number }>({
    marker: null,
    raf: 0,
  });

  const stopPlane = useCallback(() => {
    cancelAnimationFrame(planeRef.current.raf);
    planeRef.current.marker?.remove();
    planeRef.current.marker = null;
  }, []);

  /** Fly a small plane along the given arc coordinates, looping. */
  const startPlane = useCallback((coords: [number, number][]) => {
    stopPlane();
    const map = mapRef.current;
    if (!map || reduceRef.current || coords.length < 2) return;

    // cumulative distance for constant ground speed
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      const a = { lat: coords[i - 1][1], lon: coords[i - 1][0] } as Airport;
      const b = { lat: coords[i][1], lon: coords[i][0] } as Airport;
      cum.push(cum[i - 1] + haversineKm(a, b));
    }
    const total = cum[cum.length - 1];
    if (total < 10) return;
    const dur = Math.min(9000, Math.max(3500, total / 2));
    const pause = 900;

    const el = document.createElement("div");
    el.className = "plane-marker";
    el.innerHTML =
      '<div class="plane-inner"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="display:block"><path d="M21.5 15.5 13.5 11V4.75a1.5 1.5 0 0 0-3 0V11l-8 4.5v2l8-2.25V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13.5 19v-3.75l8 2.25z"/></svg></div>';
    const inner = el.firstChild as HTMLDivElement;
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(coords[0])
      .addTo(map);
    planeRef.current.marker = marker;

    const at = (dist: number): [number, number] => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < dist) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const f = Math.min(1, Math.max(0, (dist - cum[i - 1]) / seg));
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f,
      ];
    };

    const start = performance.now();
    const frame = (now: number) => {
      const m = mapRef.current;
      if (!m || !planeRef.current.marker) return;
      const e = (now - start) % (dur + pause);
      const t = Math.min(1, e / dur);
      inner.style.opacity = e <= dur ? "1" : "0";
      const pos = at(t * total);
      marker.setLngLat(pos);
      const ahead = at(Math.min(total, t * total + Math.max(20, total / 200)));
      const p1 = m.project(pos);
      const p2 = m.project(ahead);
      const ang = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
      inner.style.transform = `rotate(${ang + 90}deg)`;
      planeRef.current.raf = requestAnimationFrame(frame);
    };
    planeRef.current.raf = requestAnimationFrame(frame);
  }, [stopPlane]);

  const [readout, setReadout] = useState<Readout | null>(null);
  const [route, setRoute] = useState<RouteInfo>(null);
  const [noRoute, setNoRoute] = useState<{ from: string; to: string } | null>(null);
  const [drive, setDrive] = useState<DriveInfo | null>(null);
  const driveSeq = useRef(0);

  const clearDrive = useCallback(() => {
    driveSeq.current++;
    setDrive(null);
    const src = mapRef.current?.getSource("drive-line") as GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
  }, []);

  /** Fetch the driving alternative from OSRM and suggest an overnight stop. */
  const fetchDrive = useCallback(async (from: string, to: string) => {
    const data = dataRef.current;
    if (!data) return;
    const A = data.airports[from], B = data.airports[to];
    if (!A || !B) return;
    clearDrive();
    if (haversineKm(A, B) > DRIVE_MAX_KM) return;
    const seq = driveSeq.current;
    try {
      const url = `${OSRM}/${A.lon},${A.lat};${B.lon},${B.lat}?overview=full&geometries=geojson`;
      const r = await fetch(url);
      if (!r.ok) return;
      const j = await r.json();
      const routeR = j?.routes?.[0];
      if (seq !== driveSeq.current || !routeR?.geometry?.coordinates?.length) return;

      const km = Math.round(routeR.distance / 1000);
      const hours = routeR.duration / 3600;
      const coords: [number, number][] = routeR.geometry.coordinates;

      // Overnight stop: the point halfway along the drive, named after the
      // nearest known airport city within 150 km.
      let stop: DriveInfo["stop"] = null;
      if (hours > 8) {
        const mid = coords[Math.floor(coords.length / 2)];
        const midA = { lat: mid[1], lon: mid[0] } as Airport;
        let best: Airport | null = null, bd = 150;
        for (const code in data.airports) {
          const ap = data.airports[code];
          if (!ap.city) continue;
          const dKm = haversineKm(midA, ap);
          if (dKm < bd) { bd = dKm; best = ap; }
        }
        if (best) stop = { city: best.city, country: best.country };
      }

      setDrive({ km, hours, stop });
      const src = mapRef.current?.getSource("drive-line") as GeoJSONSource | undefined;
      src?.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }],
      });
    } catch {
      /* routing service unreachable — flight-only view stays */
    }
  }, [clearDrive]);

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

    stopPlane();
    clearDrive();
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
      zoom: Math.max(map.getZoom(), 2.7),
      duration: 1600,
      essential: false,
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
  }, [stopPlane, clearDrive]);

  // ---- A -> B route mode ----
  const drawRoutePaths = useCallback((paths: RoutePath[], sel: number) => {
    const data = dataRef.current;
    const map = mapRef.current;
    if (!data || !map) return;
    const apt = (c: string) => data.airports[c];

    const lineCoords = (codes: string[]): [number, number][] => {
      const coords: [number, number][] = [];
      for (let i = 0; i < codes.length - 1; i++) {
        const seg = gcArc(apt(codes[i]), apt(codes[i + 1]));
        coords.push(...(i === 0 ? seg : seg.slice(1)));
      }
      return coords;
    };
    const line = (codes: string[]): GeoJSON.Feature => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: lineCoords(codes) },
    });

    const main = paths[sel];
    const mainCoords = lineCoords(main.codes);
    setData("route-main", fc([{
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: mainCoords },
    }]));
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
    // cinematic sweep: ease out to frame the whole journey
    map.fitBounds(b, {
      padding: panelPadding(),
      animate: !reduceRef.current,
      maxZoom: 6.5,
      duration: 1500,
    });

    startPlane(mainCoords);
  }, [startPlane]);

  const computeRoute = useCallback((from: string, to: string) => {
    const data = dataRef.current;
    if (!data || !mapReady.current) return;
    const raw = shortestPaths(from, to, data.adj);
    setReadout(null);

    if (!raw || raw.length === 0) {
      stopPlane();
      clearDrive();
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
    fetchDrive(from, to);
  }, [drawRoutePaths, stopPlane, clearDrive, fetchDrive]);

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

  // ---- theme ----
  const getStyle = useCallback(async (t: ThemeName): Promise<StyleSpecification> => {
    const cached = styleCache.current[t];
    if (cached) return cached;
    try {
      const r = await fetch(THEMES[t].style);
      if (r.ok) {
        const j = (await r.json()) as StyleSpecification;
        styleCache.current[t] = j;
        return j;
      }
    } catch {
      /* tile CDN unreachable — use the plain ground */
    }
    return fallbackStyle(THEMES[t].ground);
  }, []);

  const applyTheme = useCallback(
    async (t: ThemeName) => {
      themeRef.current = t;
      setTheme(t);
      if (t === "night") document.documentElement.dataset.theme = "night";
      else delete document.documentElement.dataset.theme;
      try {
        localStorage.setItem("ti-theme", t);
      } catch {
        /* private mode */
      }
      const map = mapRef.current;
      if (!map || !mapReady.current) return;
      stopPlane();
      const style = await getStyle(t);
      map.setStyle(style);
      // setStyle wipes our sources/layers — re-add once the new style is in.
      const readd = () => {
        if (!map.isStyleLoaded()) {
          map.once("idle", readd);
          return;
        }
        addLayersRef.current();
        applySelection();
      };
      map.once("styledata", readd);
    },
    [getStyle, stopPlane, applySelection],
  );

  // ---- boot: map + data ----
  useEffect(() => {
    reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!containerRef.current) return;

    let map: maplibregl.Map | null = null;
    let alive = true;
    let handlersAttached = false;

    const addLayers = () => {
      const m = map;
      if (!m) return;
      const T = THEMES[themeRef.current];
      const empty = fc([]);
      const gradient = [
        "interpolate", ["linear"], ["line-progress"],
        0, T.grad[0],
        0.5, T.grad[1],
        1, T.grad[2],
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
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.4, 4, 2.6, 8, 4.5],
            "circle-color": T.dots,
          },
        });
        // Generous invisible hit area so airports are easy to click.
        m.addLayer({
          id: "airport-hit",
          source: "airports",
          type: "circle",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 4, 10, 8, 14],
            "circle-color": "#000",
            "circle-opacity": 0.001,
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
      geo("drive-line");

      if (!m.getLayer("fan-arcs-l")) {
        m.addLayer({
          id: "drive-line-l", source: "drive-line", type: "line",
          paint: {
            "line-color": T.drive,
            "line-width": 2,
            "line-opacity": 0.85,
            "line-dasharray": [2, 1.6],
          },
        });
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
          paint: { "circle-radius": 2.4, "circle-color": T.dest },
        });
        m.addLayer({
          id: "route-stops-l", source: "route-stops", type: "circle",
          paint: {
            "circle-radius": ["case", ["==", ["get", "end"], 1], 5, 3.5],
            "circle-color": ["case", ["==", ["get", "end"], 1], T.origin, T.stop],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": T.stopStroke,
          },
        });
        m.addLayer({
          id: "origin-halo-l", source: "origin-dot", type: "circle",
          paint: { "circle-radius": 13, "circle-color": T.halo },
        });
        m.addLayer({
          id: "origin-dot-l", source: "origin-dot", type: "circle",
          paint: { "circle-radius": 4.5, "circle-color": T.origin },
        });
      }

      // hover + click on airport dots (bind once — they survive setStyle)
      if (handlersAttached) return;
      handlersAttached = true;
      m.on("mousemove", "airport-hit", (e) => {
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
      m.on("mouseleave", "airport-hit", () => {
        m.getCanvas().style.cursor = "";
        setTip(null);
      });
      m.on("click", "airport-hit", (e) => {
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

    addLayersRef.current = addLayers;

    // Theme was stamped on <html> by the inline script before hydration.
    const initTheme: ThemeName =
      document.documentElement.dataset.theme === "night" ? "night" : "day";
    themeRef.current = initTheme;
    setTheme(initTheme);

    // Resolve style + data first, then create the map — no load-order races.
    const styleP = getStyle(initTheme);
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
      stopPlane();
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
  const cityOf = (c: string) => {
    const a = dataRef.current?.airports[c];
    return a?.city || a?.name || c;
  };

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

        <div className="fieldstack">
        <button className="swapfab" onClick={swap} aria-label="Swap origin and destination">⇅</button>
        <div className="searchwrap">
          <div className="search">
            <span className="slot-ic ic-from" aria-hidden="true" />
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
            <span className="slot-ic ic-to" aria-hidden="true" />
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
        </div>

        <div className="actions">
          <button className="btn" onClick={surprise}>✦ Surprise me</button>
          <button className="btn" onClick={biggestHub}>◎ Biggest hub</button>
          <button
            className="btn"
            onClick={() => applyTheme(theme === "night" ? "day" : "night")}
            aria-label={theme === "night" ? "Switch to day theme" : "Switch to night theme"}
          >
            {theme === "night" ? "☀ Day" : "☾ Night"}
          </button>
        </div>
        <Link className="dailylink" href="/daily/">
          ✈ Play today’s Daily Hop puzzle →
        </Link>
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
              {cityOf(noRoute.from)} → {cityOf(noRoute.to)}
            </p>
            <p className="origin-sub">
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
            <div className="jc-head">
              <p className="origin-name">
                {cityOf(route.from)} <span className="jc-arrow">→</span> {cityOf(route.to)}
              </p>
              <p className="origin-sub">
                {route.from} → {route.to} ·{" "}
                {route.paths[route.sel].codes.length === 2
                  ? "non-stop"
                  : `best: ${route.paths[route.sel].codes.length - 2} stop${route.paths[route.sel].codes.length > 3 ? "s" : ""} · ${route.paths.length} option${route.paths.length > 1 ? "s" : ""}`}
              </p>
            </div>
            <div className="chips">
              <span className="chip hi">
                ✈ {route.paths[route.sel].codes.length - 1} flight{route.paths[route.sel].codes.length > 2 ? "s" : ""}
              </span>
              <span className="chip">{route.paths[route.sel].km.toLocaleString("en-US")} km</span>
              <span className="chip">
                ≈ {fmtH(route.paths[route.sel].km / 840 + 0.45 + (route.paths[route.sel].codes.length - 2) * 1.5)}
              </span>
            </div>
            <div className="ropts">
              {route.paths.map((p, i) => (
                <div
                  key={p.codes.join("-")}
                  className={`ropt${i === route.sel ? " sel" : ""}`}
                  onClick={() => selectRouteOption(i)}
                >
                  <span className="path">
                    {p.codes.map((c, j) => (
                      <span key={c + j}>
                        {j > 0 && <span className="sep"> → </span>}
                        {cityOf(c)}
                      </span>
                    ))}
                  </span>
                  <span className="meta">
                    <span className="codes">{p.codes.join("–")}</span>
                    <span className="km">{p.km.toLocaleString("en-US")} km</span>
                  </span>
                </div>
              ))}
            </div>
            {drive && (
              <div className="compare">
                <div className="modecards">
                  <div className="modecard fly">
                    <span className="mc-ic">✈</span>
                    <b>{fmtH(route.paths[route.sel].km / 840 + 0.45 + (route.paths[route.sel].codes.length - 2) * 1.5)}</b>
                    <small>{route.paths[route.sel].km.toLocaleString("en-US")} km · fly</small>
                  </div>
                  <div className="modecard drive">
                    <span className="mc-ic">🚗</span>
                    <b>{fmtH(drive.hours)}</b>
                    <small>{drive.km.toLocaleString("en-US")} km · drive</small>
                  </div>
                </div>
                {drive.stop && (
                  <div className="callout">
                    <span className="co-ic">🛏</span>
                    <div className="co-body">
                      <p>
                        {fmtH(drive.hours)} behind the wheel is rough — break the trip
                        around <b>{drive.stop.city}</b> ({drive.stop.country}).
                      </p>
                      <a
                        className="linkbtn"
                        href={`https://www.booking.com/searchresults.html?ss=${encodeURIComponent(drive.stop.city)}`}
                        target="_blank" rel="noopener nofollow"
                      >
                        Hotels in {drive.stop.city} →
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="far small">
              Fewest-hop routes from the open route network. Carriers and
              schedules not included — verify times before booking.
              {drive ? " Driving route © OSRM / OpenStreetMap." : ""}
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
