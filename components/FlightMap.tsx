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

export default function FlightMap({ initial = "DUS" }: { initial?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<FlightData | null>(null);
  const selectedRef = useRef<string | null>(null);
  const progRef = useRef(0);
  const rafRef = useRef(0);
  const reduceRef = useRef(false);

  const [readout, setReadout] = useState<Readout | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<string[]>([]);
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

    // graticule
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
    const prog = progRef.current;
    const dim = selected ? 0.55 : 1;

    // airport dot cloud — forms the continents
    ctx.fillStyle = `rgba(120,150,200,${0.34 * dim})`;
    for (const code in airports) {
      const a = airports[code];
      ctx.fillRect(px(a.lon) - 0.6, py(a.lat) - 0.6, 1.4, 1.4);
    }

    if (selected && airports[selected]) {
      const o = airports[selected];
      const ox = px(o.lon), oy = py(o.lat);
      const dests = adj[selected] ?? [];

      const drawArc = (dx: number, dy: number, alpha: number) => {
        const mx = (ox + dx) / 2, my = (oy + dy) / 2;
        const dist = Math.hypot(dx - ox, dy - oy);
        const nx = -(dy - oy), ny = dx - ox;
        const nl = Math.hypot(nx, ny) || 1;
        const lift = Math.min(dist * 0.22, 90);
        const cx = mx + (nx / nl) * lift;
        const cy = my + (ny / nl) * lift - dist * 0.05;
        const grad = ctx.createLinearGradient(ox, oy, dx, dy);
        grad.addColorStop(0, `rgba(79,227,255,${0.5 * alpha})`);
        grad.addColorStop(0.5, `rgba(255,207,107,${0.55 * alpha})`);
        grad.addColorStop(1, `rgba(255,138,61,${0.28 * alpha})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
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

      dests.forEach((d, j) => {
        const dd = airports[d];
        if (!dd) return;
        const appear = Math.min(1, Math.max(0, (prog * dests.length - j) / 6));
        if (appear <= 0) return;
        drawArc(px(dd.lon), py(dd.lat), appear);
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

      // origin pulse
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
      if (!selectedRef.current) return;
      draw();
      rafRef.current = requestAnimationFrame(p);
    };
    rafRef.current = requestAnimationFrame(p);
  }, [draw]);

  const animateSelect = useCallback(() => {
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

  const select = useCallback(
    (code: string) => {
      const data = dataRef.current;
      if (!data || !data.adj[code]) return;
      selectedRef.current = code;
      progRef.current = 0;

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
      animateSelect();
    },
    [animateSelect],
  );

  const pick = useCallback(
    (code: string) => {
      const data = dataRef.current;
      if (!data) return;
      setQuery(`${data.airports[code].name} (${code})`);
      setHits([]);
      setActIdx(-1);
      select(code);
    },
    [select],
  );

  // ---- boot: fetch data, size canvas ----
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
  const search = (term: string) => {
    setQuery(term);
    const data = dataRef.current;
    term = term.trim().toLowerCase();
    if (!data || !term) { setHits([]); return; }
    const scored: [number, string][] = [];
    for (const code in data.adj) {
      const a = data.airports[code];
      if (!a) continue;
      const c = code.toLowerCase();
      const city = (a.city || "").toLowerCase();
      const name = (a.name || "").toLowerCase();
      let s = 99;
      if (c === term) s = 0;
      else if (c.startsWith(term)) s = 1;
      else if (city.startsWith(term)) s = 2;
      else if (name.startsWith(term)) s = 3;
      else if (city.includes(term)) s = 4;
      else if (name.includes(term)) s = 5;
      if (s < 99) scored.push([s, code]);
    }
    scored.sort(
      (x, y) => x[0] - y[0] || data.adj[y[1]].length - data.adj[x[1]].length,
    );
    setHits(scored.slice(0, 8).map((h) => h[1]));
    setActIdx(-1);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") { setActIdx((i) => Math.min(hits.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setActIdx((i) => Math.max(0, i - 1)); e.preventDefault(); }
    else if (e.key === "Enter") { pick(hits[actIdx >= 0 ? actIdx : 0]); e.preventDefault(); }
    else if (e.key === "Escape") setHits([]);
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
    if (code && dataRef.current?.adj[code]) pick(code);
  };

  const surprise = () => {
    const data = dataRef.current;
    if (!data) return;
    const keys = Object.keys(data.adj);
    pick(keys[Math.floor(Math.random() * keys.length)]);
  };

  const biggestHub = () => {
    const data = dataRef.current;
    if (!data) return;
    let best = "", bn = 0;
    for (const k in data.adj) {
      if (data.adj[k].length > bn) { bn = data.adj[k].length; best = k; }
    }
    pick(best);
  };

  const data = dataRef.current;

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
        <p className="eyebrow">Direct flight explorer</p>
        <h1>
          Where can you fly <span className="accent">non-stop?</span>
        </h1>
        <p className="sub">
          Pick any airport. Every glowing arc is a direct route out of it.
          3,257 airports, 67,663 routes.
        </p>
        <div className="searchwrap">
          <div className="search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={onKey}
              placeholder={loaded ? "Search a city or airport code…" : "Loading route data…"}
              autoComplete="off"
              spellCheck={false}
              aria-label="Search airport"
            />
          </div>
          {hits.length > 0 && data && (
            <div className="results" role="listbox">
              {hits.map((c, i) => (
                <div
                  key={c}
                  role="option"
                  aria-selected={i === actIdx}
                  className={`hit${i === actIdx ? " active" : ""}`}
                  onClick={() => pick(c)}
                >
                  <span className="code">{c}</span>
                  <span className="nm">
                    {data.airports[c].name}
                    {data.airports[c].city ? ` · ${data.airports[c].city}` : ""}
                  </span>
                  <span className="cc">{data.adj[c].length} routes</span>
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

      <div className={`panel readout${readout ? " show" : ""}`}>
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

      <div className="foot">
        <Link href="/airports/">all airports</Link> · data: OpenFlights + OurAirports
        <br />
        free · open data · no map tiles
      </div>
    </div>
  );
}
