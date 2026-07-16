"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Airport = { name: string; city: string; country: string; lat: number; lon: number };
type FlightData = { airports: Record<string, Airport>; adj: Record<string, string[]> };
type Puzzle = {
  from: string; to: string; par: number; via: string[];
  fromCity: string; toCity: string; fromCountry: string; toCountry: string;
};

const EPOCH = Date.UTC(2026, 6, 14); // day 0 of the daily series
const dayIndex = () => Math.floor((Date.now() - EPOCH) / 86400000);

type SaveState = { day: number; chain: string[]; done: boolean; gaveUp: boolean };
type Stats = { streak: number; best: number; played: number; wins: number; lastDay: number };

const loadStats = (): Stats => {
  try {
    return { streak: 0, best: 0, played: 0, wins: 0, lastDay: -999, ...JSON.parse(localStorage.getItem("ti-daily-stats") || "{}") };
  } catch { return { streak: 0, best: 0, played: 0, wins: 0, lastDay: -999 }; }
};

export default function DailyPuzzle() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<FlightData | null>(null);

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [day, setDay] = useState(0);
  const [chain, setChain] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<string[]>([]);
  const [actIdx, setActIdx] = useState(-1);
  const [flash, setFlash] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({ streak: 0, best: 0, played: 0, wins: 0, lastDay: -999 });
  const [copied, setCopied] = useState(false);

  const cur = chain[chain.length - 1];
  const flights = chain.length - 1;

  // ---- boot ----
  useEffect(() => {
    const d = dayIndex();
    setDay(d);
    setStats(loadStats());
    Promise.all([
      fetch("/flight-data.json").then((r) => r.json()),
      fetch("/daily-puzzles.json").then((r) => r.json()),
    ]).then(([data, puzzles]: [FlightData, Puzzle[]]) => {
      dataRef.current = data;
      const p = puzzles[((d % puzzles.length) + puzzles.length) % puzzles.length];
      setPuzzle(p);
      // resume today's progress if any
      let saved: SaveState | null = null;
      try { saved = JSON.parse(localStorage.getItem("ti-daily-save") || "null"); } catch { }
      if (saved && saved.day === d) {
        setChain(saved.chain); setDone(saved.done); setGaveUp(saved.gaveUp);
      } else {
        setChain([p.from]);
      }
    });
  }, []);

  // ---- persist progress ----
  useEffect(() => {
    if (!puzzle) return;
    try {
      localStorage.setItem("ti-daily-save", JSON.stringify({ day, chain, done, gaveUp }));
    } catch { }
  }, [puzzle, day, chain, done, gaveUp]);

  // ---- draw self-contained dot map ----
  const draw = useCallback(() => {
    const cv = canvasRef.current, data = dataRef.current, p = puzzle;
    if (!cv || !data || !p) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const W = cv.clientWidth, H = cv.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    const px = (lon: number) => ((lon + 180) / 360) * W;
    const py = (lat: number) => ((90 - lat) / 180) * H;
    ctx.clearRect(0, 0, W, H);

    const cs = getComputedStyle(document.documentElement);
    const cOrigin = cs.getPropertyValue("--origin").trim() || "#0284c7";
    const cWarm = cs.getPropertyValue("--arc-b").trim() || "#ea580c";
    const isNight = document.documentElement.dataset.theme === "night";

    // faint airport cloud = the continents
    ctx.fillStyle = isNight ? "rgba(126,158,208,.4)" : "rgba(71,94,128,.4)";
    for (const c in data.airports) {
      const a = data.airports[c];
      ctx.fillRect(px(a.lon) - 0.5, py(a.lat) - 0.5, 1.2, 1.2);
    }

    const node = (code: string, r: number, fill: string, ring?: string) => {
      const a = data.airports[code]; if (!a) return;
      const x = px(a.lon), y = py(a.lat);
      if (ring) { ctx.beginPath(); ctx.fillStyle = ring; ctx.arc(x, y, r * 2.6, 0, 7); ctx.fill(); }
      ctx.beginPath(); ctx.fillStyle = fill; ctx.arc(x, y, r, 0, 7); ctx.fill();
    };
    const arc = (a: string, b: string, color: string, w: number) => {
      const A = data.airports[a], B = data.airports[b]; if (!A || !B) return;
      const ox = px(A.lon), oy = py(A.lat), dx = px(B.lon), dy = py(B.lat);
      const mx = (ox + dx) / 2, my = (oy + dy) / 2, dist = Math.hypot(dx - ox, dy - oy);
      const nx = -(dy - oy), ny = dx - ox, nl = Math.hypot(nx, ny) || 1, lift = Math.min(dist * 0.2, 70);
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(ox, oy);
      ctx.quadraticCurveTo(mx + nx / nl * lift, my + ny / nl * lift, dx, dy); ctx.stroke();
    };

    // player's chain
    for (let i = 0; i < chain.length - 1; i++) arc(chain[i], chain[i + 1], cWarm, 1.8);
    for (let i = 1; i < chain.length - 1; i++) node(chain[i], 3, cWarm);

    // endpoints
    node(p.from, 4.5, cOrigin, cOrigin.replace(")", ", .16)").replace("rgb", "rgba"));
    node(p.to, 4.5, done ? cWarm : "transparent", "rgba(120,150,180,.18)");
    // target ring
    const T = data.airports[p.to];
    ctx.beginPath(); ctx.strokeStyle = cWarm; ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]); ctx.arc(px(T.lon), py(T.lat), 8, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }, [puzzle, chain, done]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const r = () => draw();
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, [draw]);

  // ---- guessing ----
  const search = (term: string) => {
    setQuery(term);
    const data = dataRef.current;
    const t = term.trim().toLowerCase();
    if (!data || !t || !cur) { setHits([]); return; }
    // only airports directly reachable from current airport
    const reach = data.adj[cur] || [];
    const scored: [number, string][] = [];
    for (const code of reach) {
      const a = data.airports[code]; if (!a) continue;
      const c = code.toLowerCase(), city = (a.city || "").toLowerCase(), name = (a.name || "").toLowerCase(), country = (a.country || "").toLowerCase();
      let s = 99;
      if (c === t) s = 0; else if (c.startsWith(t)) s = 1;
      else if (city.startsWith(t)) s = 2; else if (name.startsWith(t)) s = 3;
      else if (country === t) s = 4; else if (city.includes(t)) s = 5;
      else if (name.includes(t)) s = 6;
      if (s < 99) scored.push([s, code]);
    }
    scored.sort((x, y) => x[0] - y[0] || (data.adj[y[1]]?.length ?? 0) - (data.adj[x[1]]?.length ?? 0));
    setHits(scored.slice(0, 8).map((h) => h[1]));
    setActIdx(-1);
  };

  const recordFinish = (won: boolean) => {
    setStats((s) => {
      const yesterday = s.lastDay === day - 1;
      const streak = won ? (yesterday || s.lastDay === day ? s.streak : 0) + (s.lastDay === day ? 0 : 1) : 0;
      const next: Stats = {
        played: s.played + (s.lastDay === day ? 0 : 1),
        wins: s.wins + (won && s.lastDay !== day ? 1 : 0),
        streak,
        best: Math.max(s.best, streak),
        lastDay: day,
      };
      try { localStorage.setItem("ti-daily-stats", JSON.stringify(next)); } catch { }
      return next;
    });
  };

  const addAirport = (code: string) => {
    const data = dataRef.current, p = puzzle;
    if (!data || !p || done) return;
    if (!(data.adj[cur] || []).includes(code)) {
      setFlash(`No direct flight from ${data.airports[cur]?.city || cur}`);
      setTimeout(() => setFlash(null), 1800);
      return;
    }
    const nextChain = [...chain, code];
    setChain(nextChain);
    setQuery(""); setHits([]); setActIdx(-1);
    if (code === p.to) { setDone(true); recordFinish(true); }
  };

  const giveUp = () => {
    const p = puzzle; if (!p) return;
    setChain([p.from, ...p.via, p.to]);
    setGaveUp(true); setDone(true); recordFinish(false);
  };

  const reset = () => {
    if (!puzzle) return;
    setChain([puzzle.from]); setDone(false); setGaveUp(false); setQuery(""); setHits([]);
  };

  const shareText = () => {
    if (!puzzle) return "";
    const n = ((day % 366) + 366) % 366 + 1;
    const result = gaveUp ? "❌ gave up" : `✈️ ${flights} flight${flights === 1 ? "" : "s"} (par ${puzzle.par})`;
    const squares = gaveUp ? "" : "\n" + "🟦".repeat(flights).replace(/🟦$/, "🟧");
    return `TravelIntel Daily Hop #${n}\n${puzzle.fromCity} → ${puzzle.toCity}\n${result}${squares}\ntravelintel.pages.dev/daily/`;
  };

  const share = async () => {
    const text = shareText();
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { }
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") { setActIdx((i) => Math.min(hits.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setActIdx((i) => Math.max(0, i - 1)); e.preventDefault(); }
    else if (e.key === "Enter") { addAirport(hits[actIdx >= 0 ? actIdx : 0]); e.preventDefault(); }
    else if (e.key === "Escape") setHits([]);
  };

  const data = dataRef.current;
  const cityLabel = (c: string) => data?.airports[c]?.city || data?.airports[c]?.name || c;

  if (!puzzle) return <div className="dp-load">Loading today’s puzzle…</div>;

  const win = done && !gaveUp;
  const par = puzzle.par;
  const verdict = flights <= par ? "Par or better — nice." : flights === par + 1 ? "One over par." : `${flights - par} over par.`;

  return (
    <div className="dp">
      <canvas ref={canvasRef} className="dp-map" aria-hidden="true" />

      <div className="dp-panel">
        <p className="wordmark-row">
          <Link className="wordmark" href="/">TravelIntel</Link>
        </p>
        <p className="eyebrow">Daily Hop · #{((day % 366) + 366) % 366 + 1}</p>
        <h1 className="dp-h1">
          <span className="accent">{puzzle.fromCity}</span> to <span className="accent">{puzzle.toCity}</span>
        </h1>
        <p className="dp-sub">
          Connect them in as few flights as possible. Best possible: <b>{par}</b> flight{par === 1 ? "" : "s"}.
        </p>

        <div className="dp-chain">
          {chain.map((c, i) => (
            <span key={c + i} className="dp-hop">
              {i > 0 && <span className="dp-arrow">→</span>}
              <span className={`dp-code${i === 0 ? " start" : c === puzzle.to ? " end" : ""}`}>{c}</span>
              <span className="dp-city">{cityLabel(c)}</span>
            </span>
          ))}
          {!done && (
            <span className="dp-hop pending">
              <span className="dp-arrow">→</span>
              <span className="dp-target">{puzzle.to} · {puzzle.toCity}?</span>
            </span>
          )}
        </div>

        {!done && (
          <div className="dp-input">
            <div className="dp-field">
              <span className="dp-from">from {cityLabel(cur)}</span>
              <input
                value={query}
                onChange={(e) => search(e.target.value)}
                onKeyDown={onKey}
                placeholder="type the next city or code…"
                autoComplete="off" spellCheck={false} autoFocus
                aria-label="Next airport"
              />
            </div>
            {hits.length > 0 && data && (
              <div className="results" role="listbox">
                {hits.map((c, i) => (
                  <div key={c} role="option" aria-selected={i === actIdx}
                    className={`hit${i === actIdx ? " active" : ""}`} onClick={() => addAirport(c)}>
                    <span className="code">{c}</span>
                    <span className="nm">{data.airports[c].name}<span className="loc"> · {data.airports[c].city ? data.airports[c].city + ", " : ""}{data.airports[c].country}</span></span>
                  </div>
                ))}
              </div>
            )}
            {flash && <p className="dp-flash">{flash}</p>}
          </div>
        )}

        {done && (
          <div className="dp-result">
            {win ? (
              <>
                <p className="dp-win">Landed in {flights} flight{flights === 1 ? "" : "s"}. {verdict}</p>
                <div className="dp-streak">
                  <span><b>{stats.streak}</b> day streak</span>
                  <span><b>{stats.best}</b> best</span>
                  <span><b>{stats.wins}</b> solved</span>
                </div>
              </>
            ) : (
              <p className="dp-win">One solution: {[puzzle.from, ...puzzle.via, puzzle.to].join(" → ")}</p>
            )}
            <div className="dp-actions">
              <button className="btn primary" onClick={share}>{copied ? "Copied!" : "Share result"}</button>
              <button className="btn" onClick={reset}>Try again</button>
            </div>
            <p className="dp-next">Next puzzle in {24 - new Date().getUTCHours()}h · come back tomorrow</p>
          </div>
        )}

        {!done && (
          <div className="dp-actions">
            <button className="btn" onClick={() => { if (chain.length > 1) setChain(chain.slice(0, -1)); }} disabled={chain.length <= 1}>↩ Undo</button>
            <button className="btn" onClick={giveUp}>Give up</button>
          </div>
        )}

        <div className="dp-foot">
          <Link href="/">← back to the map</Link>
        </div>
      </div>
    </div>
  );
}
