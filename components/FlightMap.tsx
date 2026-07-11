"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

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

export default function FlightMap({ initial = "DUS" }: { initial?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<FlightData | null>(null);
  const selectedRef = useRef<string | null>(null);
  const routeRef = useRef<{ main: string[]; alts: string[][] } | null>(null);
  const progRef = useRef(0);
  const rafRef = useRef(0);
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

  // ---- drawing ----
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const data = dataRef.current;
    if (!cv || !data) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    const px = (lon: number) => ((lon + 180) / 360) * W;
    const py = (lat: number) => ((90 - lat) / 180) * H;

    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(120,150,200,.06)";
    ctx.lineWidth = 1;
    for (let g = -150; g <= 150; g += 30) {
      const x = px(g);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let l = -60; l <= 60; l += 30) {
      const y = py(l);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const { airports, adj } = data;
    const selected = selectedRef.current;
    const routeSel = routeRef.current;
    const prog = progRef.current;
    const dim = selected || routeSel ? 0.55 : 1;

    ctx.fillStyle = `rgba(120,150,200,${0.34 * dim})`;
    for (const code in airports) {
      const a = airports[code];
      ctx.fillRect(px(a.lon) - 0.6, py(a.lat) - 0.6, 1.4, 1.4);
    }

    const arc = (
      ox: number, oy: number, dx: number, dy: number,
      alpha: number, width: number, warm: boolean,
    ) => {
      const mx = (ox + dx) / 2, my = (oy + dy) / 2;
      const d = Math.hypot(dx - ox, dy - oy);
      const nx = -(dy - oy), ny = dx - ox;
      const nl = Math.hypot(nx, ny) || 1;
      const lift = Math.min(d * 0.22, 90);
      const cx = mx + (nx / nl) * lift;
      const cy = my + (ny / nl) * lift - d * 0.05;
      const grad = ctx.createLinearGradient(ox, oy, dx, dy);
      if (warm) {
        grad.addColorStop(0, `rgba(79,227,255,${0.85 * alpha})`);
        grad.addColorStop(0.5, `rgba(255,207,107,${0.9 * alpha})`);
        grad.addColorStop(1, `rgba(255,138,61,${0.75 * alpha})`);
      } else {
        grad.addColorStop(0, `rgba(79,227,255,${0.5 * alpha})`);
        grad.addColorStop(0.5, `rgba(255,207,107,${0.55 * alpha})`);
        grad.addColorStop(1, `rgba(255,138,61,${0.28 * alpha})`);
      }
      ctx.strokeStyle = grad;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      const steps = 18;
      for (let t = 0; t <= steps; t++) {
        const tt = (t / steps) * alpha;
        const x = (1 - tt) * (1 - tt) * ox + 2 * (1 - tt) * tt * cx + tt * tt * dx;
        const y = (1 - tt) * (1 - tt) * oy + 2 * (1 - tt) * tt * cy + tt * tt * dy;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    const node = (code: string, r: number, fill: string) => {
      const a = airports[code];
      if (!a) return;
      ctx.beginPath();
      ctx.fillStyle = fill;
      ctx.arc(px(a.lon), py(a.lat), r, 0, 7);
      ctx.fill();
    };

    if (routeSel) {
      // alternative paths, faint
      for (const alt of routeSel.alts) {
        for (let i = 0; i < alt.length - 1; i++) {
          const a = airports[alt[i]], b = airports[alt[i + 1]];
          if (!a || !b) continue;
          arc(px(a.lon), py(a.lat), px(b.lon), py(b.lat), 0.18, 1, false);
        }
      }
      // main path, staged leg by leg
      const legs = routeSel.main.length - 1;
      for (let i = 0; i < legs; i++) {
        const a = airports[routeSel.main[i]], b = airports[routeSel.main[i + 1]];
        if (!a || !b) continue;
        const appear = Math.min(1, Math.max(0, prog * legs - i));
        if (appear <= 0) continue;
        arc(px(a.lon), py(a.lat), px(b.lon), py(b.lat), appear, 2, true);
      }
      // nodes
      routeSel.main.forEach((c, i) => {
        const isEnd = i === 0 || i === routeSel.main.length - 1;
        node(c, isEnd ? 4 : 3, isEnd ? "#4fe3ff" : "#ffcf6b");
      });
    } else if (selected && airports[selected]) {
      const o = airports[selected];
      const ox = px(o.lon), oy = py(o.lat);
      const dests = adj[selected] ?? [];

      dests.forEach((d, j) => {
        const dd = airports[d];
        if (!dd) return;
        const appear = Math.min(1, Math.max(0, (prog * dests.length - j) / 6));
        if (appear <= 0) return;
        arc(ox, oy, px(dd.lon), py(dd.lat), appear, 1, false);
      });

      dests.forEach((d, k) => {
        const dd = airports[d];
        if (!dd) return;
        const pk = Math.min(1, Math.max(0, (prog * dests.length - k) / 6));
        if (pk <= 0) return;
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,180,90,${0.9 * pk})`;
        ctx.arc(px(dd.lon), py(dd.lat), 1.9, 0, 7);
        ctx.fill();
      });

      const pr = reduceRef.current ? 3.4 : 3.2 + Math.sin(Date.now() / 380) * 1.1;
      ctx.beginPath();
      ctx.fillStyle = "rgba(79,227,255,.16)";
      ctx.arc(ox, oy, pr * 3.4, 0, 7);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "#4fe3ff";
      ctx.arc(ox, oy, pr, 0, 7);
      ctx.fill();
    }
  }, []);

  const loopPulse = useCallback(() => {
    if (reduceRef.current) return;
    cancelAnimationFrame(rafRef.current);
    const p = () => {
      if (!selectedRef.current && !routeRef.current) return;
      draw();
      rafRef.current = requestAnimationFrame(p);
    };
    rafRef.current = requestAnimationFrame(p);
  }, [draw]);

  const animate = useCallback(() => {
    if (reduceRef.current) {
      progRef.current = 1;
      draw();
      return;
    }
    cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const step = (now: number) => {
      progRef.current = Math.min(1, (now - start) / 900);
      draw();
      if (progRef.current < 1) rafRef.current = requestAnimationFrame(step);
      else loopPulse();
    };
    rafRef.current = requestAnimationFrame(step);
  }, [draw, loopPulse]);

  // ---- single-origin explore mode ----
  const select = useCallback(
    (code: string) => {
      const data = dataRef.current;
      if (!data || !data.adj[code]) return;
      selectedRef.current = code;
      routeRef.current = null;
      progRef.current = 0;
      setRoute(null);
      setNoRoute(null);

      const o = data.airports[code];
      const dests = data.adj[code] ?? [];
      const countries = new Set<string>();
      let far: Airport | null = null;
      let farKm = 0;
      for (const d of dests) {
        const dd = data.airports[d];
        if (!dd) continue;
        countries.add(dd.country);
        const km = haversineKm(o, dd);
        if (km > farKm) { farKm = km; far = dd; }
      }
      setReadout({
        code,
        name: o.name,
        sub: (o.city ? o.city + ", " : "") + o.country,
        dests: dests.length,
        countries: countries.size,
        furthest: far ? { name: far.name, country: far.country, km: Math.round(farKm) } : null,
      });
      animate();
    },
    [animate],
  );

  // ---- A -> B route mode ----
  const computeRoute = useCallback(
    (from: string, to: string) => {
      const data = dataRef.current;
      if (!data) return;
      const raw = shortestPaths(from, to, data.adj);
      selectedRef.current = null;
      setReadout(null);

      if (!raw || raw.length === 0) {
        routeRef.current = null;
        setRoute(null);
        setNoRoute({ from, to });
        draw();
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
      routeRef.current = {
        main: scored[0].codes,
        alts: scored.slice(1).map((p) => p.codes),
      };
      progRef.current = 0;
      animate();
    },
    [animate, draw],
  );

  const selectRouteOption = (idx: number) => {
    setRoute((r) => {
      if (!r) return r;
      routeRef.current = {
        main: r.paths[idx].codes,
        alts: r.paths.filter((_, i) => i !== idx).map((p) => p.codes),
      };
      progRef.current = 0;
      animate();
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

  const pick = useCallback(
    (code: string, which: "from" | "to") => {
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
    },
    [applySelection],
  );

  const clearTo = () => {
    toCode.current = null;
    setToQ("");
    setRoute(null);
    setNoRoute(null);
    routeRef.current = null;
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

  // ---- boot ----
  useEffect(() => {
    reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      const ctx = cv.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    let alive = true;
    fetch("/flight-data.json")
      .then((r) => r.json())
      .then((d: FlightData) => {
        if (!alive) return;
        dataRef.current = d;
        setLoaded(true);
        resize();
        fromCode.current = initial;
        setFromQ(`${d.airports[initial]?.name ?? initial} (${initial})`);
        select(initial);
      });

    window.addEventListener("resize", resize);
    resize();
    return () => {
      alive = false;
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw, select, initial]);

  // ---- search ----
  const search = (term: string, which: "from" | "to") => {
    if (which === "from") setFromQ(term);
    else setToQ(term);
    const data = dataRef.current;
    const t = term.trim().toLowerCase();
    if (!data || !t) { setHits(null); return; }
    const scored: [number, string][] = [];
    // From must have departures; To can be any airport in the network.
    const pool = which === "from" ? Object.keys(data.adj) : Object.keys(data.airports);
    for (const code of pool) {
      const a = data.airports[code];
      if (!a) continue;
      const c = code.toLowerCase();
      const city = (a.city || "").toLowerCase();
      const name = (a.name || "").toLowerCase();
      let s = 99;
      if (c === t) s = 0;
      else if (c.startsWith(t)) s = 1;
      else if (city.startsWith(t)) s = 2;
      else if (name.startsWith(t)) s = 3;
      else if (city.includes(t)) s = 4;
      else if (name.includes(t)) s = 5;
      if (s < 99) scored.push([s, code]);
    }
    scored.sort(
      (x, y) =>
        x[0] - y[0] ||
        (dataRef.current!.adj[y[1]]?.length ?? 0) - (dataRef.current!.adj[x[1]]?.length ?? 0),
    );
    setHits({ which, codes: scored.slice(0, 8).map((h) => h[1]) });
    setActIdx(-1);
  };

  const onKey = (e: React.KeyboardEvent, which: "from" | "to") => {
    if (!hits || hits.which !== which || !hits.codes.length) return;
    if (e.key === "ArrowDown") { setActIdx((i) => Math.min(hits.codes.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setActIdx((i) => Math.max(0, i - 1)); e.preventDefault(); }
    else if (e.key === "Enter") { pick(hits.codes[actIdx >= 0 ? actIdx : 0], which); e.preventDefault(); }
    else if (e.key === "Escape") setHits(null);
  };

  // ---- canvas hover/click ----
  const nearest = (mx: number, my: number): string | null => {
    const data = dataRef.current;
    const cv = canvasRef.current;
    if (!data || !cv) return null;
    const W = cv.clientWidth, H = cv.clientHeight;
    let best: string | null = null, bd = Infinity;
    for (const code in data.airports) {
      const a = data.airports[code];
      const dx = ((a.lon + 180) / 360) * W - mx;
      const dy = ((90 - a.lat) / 180) * H - my;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = code; }
    }
    return bd < 80 ? best : null;
  };

  const onMove = (e: React.MouseEvent) => {
    const cv = canvasRef.current;
    const data = dataRef.current;
    if (!cv || !data) return;
    const r = cv.getBoundingClientRect();
    const code = nearest(e.clientX - r.left, e.clientY - r.top);
    if (code) {
      const a = data.airports[code];
      setTip({
        x: ((a.lon + 180) / 360) * cv.clientWidth,
        y: ((90 - a.lat) / 180) * cv.clientHeight,
        code,
        name: a.name,
        routes: data.adj[code]?.length ?? 0,
      });
    } else setTip(null);
  };

  const onClick = (e: React.MouseEvent) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const code = nearest(e.clientX - r.left, e.clientY - r.top);
    if (!code) return;
    // First click (or restart) sets origin; second click sets destination.
    if (fromCode.current && !toCode.current && code !== fromCode.current) {
      pick(code, "to");
    } else {
      toCode.current = null;
      setToQ("");
      if (dataRef.current?.adj[code]) pick(code, "from");
    }
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
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
        onClick={onClick}
        aria-label="World map of airports and direct flight routes"
      />

      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          <span className="t-code">{tip.code}</span> {tip.name}
          {tip.routes > 0 && ` · ${tip.routes} routes`}
        </div>
      )}

      <div className="panel hud">
        <p className="eyebrow">Flight route explorer</p>
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
                    {data.airports[c].city ? ` · ${data.airports[c].city}` : ""}
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
                    {data.airports[c].city ? ` · ${data.airports[c].city}` : ""}
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
        <Link href="/airports/">all airports</Link> · data: OpenFlights + OurAirports
        <br />
        free · open data · no map tiles
      </div>
    </div>
  );
}
