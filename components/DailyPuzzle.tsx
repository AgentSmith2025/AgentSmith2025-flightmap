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

type Mode = "daily" | "perfect" | "practice";
type Stats = { streak: number; best: number; played: number; wins: number; lastDay: number };

const loadStats = (): Stats => {
  try {
    return { streak: 0, best: 0, played: 0, wins: 0, lastDay: -999, ...JSON.parse(localStorage.getItem("ti-daily-stats") || "{}") };
  } catch { return { streak: 0, best: 0, played: 0, wins: 0, lastDay: -999 }; }
};

function hav(a: Airport, b: Airport): number {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

export default function DailyPuzzle() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<FlightData | null>(null);
  const puzzlesRef = useRef<Puzzle[]>([]);
  const animRef = useRef({ t: 1, raf: 0 });
  const reduceRef = useRef(false);

  const [mode, setMode] = useState<Mode>("daily");
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [day, setDay] = useState(0);
  const [chain, setChain] = useState<string[]>([]);
  const [wrong, setWrong] = useState(0);
  const [done, setDone] = useState(false);
  const [won, setWon] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<string[]>([]);
  const [actIdx, setActIdx] = useState(-1);
  const [flash, setFlash] = useState<{ text: string; kind: "bad" | "info" } | null>(null);
  const [stats, setStats] = useState<Stats>({ streak: 0, best: 0, played: 0, wins: 0, lastDay: -999 });
  const [copied, setCopied] = useState(false);

  const cur = chain[chain.length - 1];
  const flights = chain.length - 1;
  const par = puzzle?.par ?? 2;
  const budget = mode === "perfect" ? par : par + 2;
  const left = budget - flights;

  const distTo = useCallback((code: string) => {
    const d = dataRef.current, p = puzzle;
    if (!d || !p || !d.airports[code] || !d.airports[p.to]) return 0;
    return hav(d.airports[code], d.airports[p.to]);
  }, [puzzle]);

  // ---- boot ----
  useEffect(() => {
    reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const d = dayIndex();
    setDay(d);
    setStats(loadStats());
    Promise.all([
      fetch("/flight-data.json").then((r) => r.json()),
      fetch("/daily-puzzles.json").then((r) => r.json()),
    ]).then(([data, puzzles]: [FlightData, Puzzle[]]) => {
      dataRef.current = data;
      puzzlesRef.current = puzzles;
      const p = puzzles[((d % puzzles.length) + puzzles.length) % puzzles.length];
      setPuzzle(p);
      let saved: { day: number; chain: string[]; wrong: number; done: boolean; won: boolean; gaveUp: boolean } | null = null;
      try { saved = JSON.parse(localStorage.getItem("ti-daily-save2") || "null"); } catch { }
      if (saved && saved.day === d) {
        setChain(saved.chain); setWrong(saved.wrong); setDone(saved.done); setWon(saved.won); setGaveUp(saved.gaveUp);
      } else {
        setChain([p.from]);
      }
    });
  }, []);

  // persist daily progress only
  useEffect(() => {
    if (!puzzle || mode !== "daily") return;
    try {
      localStorage.setItem("ti-daily-save2", JSON.stringify({ day, chain, wrong, done, won, gaveUp }));
    } catch { }
  }, [puzzle, mode, day, chain, wrong, done, won, gaveUp]);

  // ---- map ----
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

    ctx.fillStyle = isNight ? "rgba(126,158,208,.4)" : "rgba(71,94,128,.4)";
    for (const c in data.airports) {
      const a = data.airports[c];
      ctx.fillRect(px(a.lon) - 0.5, py(a.lat) - 0.5, 1.2, 1.2);
    }

    const node = (code: string, r: number, fill: string) => {
      const a = data.airports[code]; if (!a) return;
      ctx.beginPath(); ctx.fillStyle = fill; ctx.arc(px(a.lon), py(a.lat), r, 0, 7); ctx.fill();
    };
    const arc = (a: string, b: string, color: string, w: number, prog = 1) => {
      const A = data.airports[a], B = data.airports[b]; if (!A || !B) return;
      const ox = px(A.lon), oy = py(A.lat), dx = px(B.lon), dy = py(B.lat);
      const mx = (ox + dx) / 2, my = (oy + dy) / 2, dist = Math.hypot(dx - ox, dy - oy);
      const nx = -(dy - oy), ny = dx - ox, nl = Math.hypot(nx, ny) || 1, lift = Math.min(dist * 0.2, 70);
      const cx = mx + nx / nl * lift, cy = my + ny / nl * lift;
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(ox, oy);
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * prog;
        ctx.lineTo((1 - t) * (1 - t) * ox + 2 * (1 - t) * t * cx + t * t * dx,
          (1 - t) * (1 - t) * oy + 2 * (1 - t) * t * cy + t * t * dy);
      }
      ctx.stroke();
    };

    for (let i = 0; i < chain.length - 1; i++) {
      const prog = i === chain.length - 2 ? animRef.current.t : 1;
      arc(chain[i], chain[i + 1], cWarm, 1.8, prog);
    }
    for (let i = 1; i < chain.length - 1; i++) node(chain[i], 3, cWarm);
    node(p.from, 4.5, cOrigin);
    if (done && won) node(p.to, 4.5, cWarm);

    const T = data.airports[p.to];
    ctx.beginPath(); ctx.strokeStyle = cWarm; ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]); ctx.arc(px(T.lon), py(T.lat), 8, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }, [puzzle, chain, done, won]);

  useEffect(() => {
    // animate the newest leg drawing in
    if (chain.length < 2 || reduceRef.current) { animRef.current.t = 1; draw(); return; }
    cancelAnimationFrame(animRef.current.raf);
    const start = performance.now();
    const step = (now: number) => {
      animRef.current.t = Math.min(1, (now - start) / 450);
      draw();
      if (animRef.current.t < 1) animRef.current.raf = requestAnimationFrame(step);
    };
    animRef.current.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animRef.current.raf);
  }, [chain, draw]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const r = () => draw();
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, [draw]);

  // ---- search: ALL airports — guessing is the game ----
  const search = (term: string) => {
    setQuery(term);
    const data = dataRef.current;
    const t = term.trim().toLowerCase();
    if (!data || !t || !cur) { setHits([]); return; }
    const scored: [number, string][] = [];
    for (const code in data.airports) {
      if (code === cur) continue;
      const a = data.airports[code];
      const c = code.toLowerCase(), city = (a.city || "").toLowerCase(), name = (a.name || "").toLowerCase(), country = (a.country || "").toLowerCase();
      let s = 99;
      if (c === t) s = 0; else if (c.startsWith(t)) s = 1;
      else if (city.startsWith(t)) s = 2; else if (name.startsWith(t)) s = 3;
      else if (country === t) s = 4; else if (city.includes(t)) s = 5;
      if (s < 99) scored.push([s, code]);
    }
    scored.sort((x, y) => x[0] - y[0] || (data.adj[y[1]]?.length ?? 0) - (data.adj[x[1]]?.length ?? 0));
    setHits(scored.slice(0, 8).map((h) => h[1]));
    setActIdx(-1);
  };

  const recordFinish = (didWin: boolean) => {
    if (mode !== "daily") return;
    setStats((s) => {
      if (s.lastDay === day) return s; // already recorded today
      const yesterday = s.lastDay === day - 1;
      const streak = didWin ? (yesterday ? s.streak + 1 : 1) : 0;
      const next: Stats = {
        played: s.played + 1,
        wins: s.wins + (didWin ? 1 : 0),
        streak,
        best: Math.max(s.best, streak),
        lastDay: day,
      };
      try { localStorage.setItem("ti-daily-stats", JSON.stringify(next)); } catch { }
      return next;
    });
  };

  const showFlash = (text: string, kind: "bad" | "info" = "bad") => {
    setFlash({ text, kind });
    setTimeout(() => setFlash(null), 2200);
  };

  const addAirport = (code: string) => {
    const data = dataRef.current, p = puzzle;
    if (!data || !p || done) return;
    const a = data.airports[code];
    if (!(data.adj[cur] || []).includes(code)) {
      setWrong((w) => w + 1);
      setQuery(""); setHits([]);
      showFlash(`✗ No direct flight ${data.airports[cur]?.city || cur} → ${a?.city || code}`);
      return;
    }
    const before = distTo(cur);
    const after = distTo(code);
    const nextChain = [...chain, code];
    setChain(nextChain);
    setQuery(""); setHits([]); setActIdx(-1);

    if (code === p.to) {
      setDone(true); setWon(true); recordFinish(true);
      return;
    }
    if (nextChain.length - 1 >= budget) {
      // out of boarding passes, not at the destination
      setDone(true); setWon(false); recordFinish(false);
      showFlash("💥 Out of flights — stranded!", "bad");
      return;
    }
    const delta = before - after;
    if (delta > 0) showFlash(`✓ ${after.toLocaleString("en-US")} km to go — ${delta.toLocaleString("en-US")} km closer`, "info");
    else showFlash(`⚠ ${after.toLocaleString("en-US")} km to go — you flew ${(-delta).toLocaleString("en-US")} km further away`, "bad");
  };

  const giveUp = () => {
    const p = puzzle; if (!p) return;
    setChain([p.from, ...p.via, p.to]);
    setGaveUp(true); setDone(true); setWon(false); recordFinish(false);
  };

  const startPractice = () => {
    const pool = puzzlesRef.current;
    if (!pool.length) return;
    let pz = pool[(Math.random() * pool.length) | 0];
    if (puzzle && pz.from === puzzle.from && pz.to === puzzle.to) pz = pool[(Math.random() * pool.length) | 0];
    setMode("practice");
    setPuzzle(pz);
    setChain([pz.from]); setWrong(0); setDone(false); setWon(false); setGaveUp(false); setQuery(""); setHits([]);
  };

  const startPerfect = () => {
    const d = dayIndex();
    const pool = puzzlesRef.current;
    const pz = pool[((d % pool.length) + pool.length) % pool.length];
    setMode("perfect");
    setPuzzle(pz);
    setChain([pz.from]); setWrong(0); setDone(false); setWon(false); setGaveUp(false); setQuery(""); setHits([]);
  };

  const backToDaily = () => {
    const d = dayIndex();
    const pool = puzzlesRef.current;
    const pz = pool[((d % pool.length) + pool.length) % pool.length];
    setMode("daily");
    setPuzzle(pz);
    let saved: { day: number; chain: string[]; wrong: number; done: boolean; won: boolean; gaveUp: boolean } | null = null;
    try { saved = JSON.parse(localStorage.getItem("ti-daily-save2") || "null"); } catch { }
    if (saved && saved.day === d) {
      setChain(saved.chain); setWrong(saved.wrong); setDone(saved.done); setWon(saved.won); setGaveUp(saved.gaveUp);
    } else {
      setChain([pz.from]); setWrong(0); setDone(false); setWon(false); setGaveUp(false);
    }
    setQuery(""); setHits([]);
  };

  const stars = won ? (flights <= par ? 3 : flights === par + 1 ? 2 : 1) : 0;

  const shareText = () => {
    if (!puzzle) return "";
    const n = ((day % 366) + 366) % 366 + 1;
    const head = mode === "practice" ? "TravelIntel Hop (practice)" : `TravelIntel Daily Hop #${n}${mode === "perfect" ? " · PERFECT" : ""}`;
    const starLine = won ? "⭐".repeat(stars) + (mode === "perfect" ? " 🎯" : "") : gaveUp ? "🏳 gave up" : "💥 stranded";
    const trail = won ? chain.slice(1).map((c) => (flights <= par ? "🟩" : "🟨")).join("") : "";
    const wrongs = wrong > 0 ? ` ❌×${wrong}` : "";
    return `${head}\n${puzzle.fromCity} → ${puzzle.toCity}\n${starLine} ${won ? `${flights} flight${flights === 1 ? "" : "s"} (par ${par})` : ""}${wrongs}\n${trail}\ntravelintel.pages.dev/daily/`;
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

  const kmLeft = cur ? distTo(cur) : 0;

  return (
    <div className="dp">
      <canvas ref={canvasRef} className="dp-map" aria-hidden="true" />

      <div className="dp-panel">
        <p className="wordmark-row">
          <Link className="wordmark" href="/">TravelIntel</Link>
        </p>
        <p className="eyebrow">
          {mode === "practice" ? "Hop · practice" : `Daily Hop · #${((day % 366) + 366) % 366 + 1}`}
          {mode === "perfect" ? " · 🎯 perfect" : ""}
        </p>
        <h1 className="dp-h1">
          <span className="accent">{puzzle.fromCity}</span> to <span className="accent">{puzzle.toCity}</span>
        </h1>
        <p className="dp-sub">
          Reach {puzzle.toCity} ({puzzle.toCountry}) before your boarding passes run out.
          Best possible: <b>{par}</b>.
        </p>

        <div className="dp-passes" aria-label={`${left} flights remaining`}>
          {Array.from({ length: budget }).map((_, i) => (
            <span key={i} className={`dp-pass${i < flights ? " used" : ""}`}>✈</span>
          ))}
          <span className="dp-passlabel">{done ? "" : `${left} flight${left === 1 ? "" : "s"} left`}</span>
          {wrong > 0 && <span className="dp-wrongct">❌×{wrong}</span>}
        </div>

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
              <span className="dp-target">{puzzle.toCity}? · {kmLeft.toLocaleString("en-US")} km away</span>
            </span>
          )}
        </div>

        {!done && (
          <div className="dp-input">
            <div className="dp-field">
              <span className="dp-from">fly from {cityLabel(cur)} to…</span>
              <input
                value={query}
                onChange={(e) => search(e.target.value)}
                onKeyDown={onKey}
                placeholder="guess any city — wrong guesses count!"
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
          </div>
        )}
        {flash && <p className={`dp-flash ${flash.kind}`}>{flash.text}</p>}

        {done && (
          <div className="dp-result">
            {won ? (
              <>
                <p className="dp-stars">{"⭐".repeat(stars)}{mode === "perfect" ? " 🎯" : ""}</p>
                <p className="dp-win">
                  Landed in {flights} flight{flights === 1 ? "" : "s"} (par {par})
                  {wrong > 0 ? ` with ${wrong} wrong guess${wrong === 1 ? "" : "es"}` : ", no wrong guesses"}.
                </p>
              </>
            ) : (
              <p className="dp-win">
                {gaveUp ? "One solution:" : "Stranded! One solution:"}{" "}
                {[puzzle.from, ...puzzle.via, puzzle.to].map(cityLabel).join(" → ")}
              </p>
            )}
            {mode === "daily" && (
              <div className="dp-streak">
                <span><b>{stats.streak}</b> day streak</span>
                <span><b>{stats.best}</b> best</span>
                <span><b>{stats.wins}</b> solved</span>
              </div>
            )}
            <div className="dp-actions">
              <button className="btn primary" onClick={share}>{copied ? "Copied!" : "Share result"}</button>
              {mode === "daily" && won && flights <= par && (
                <button className="btn" onClick={startPerfect}>🎯 Perfect mode</button>
              )}
              <button className="btn" onClick={startPractice}>🎲 Practice</button>
            </div>
            {mode !== "daily" && (
              <div className="dp-actions">
                <button className="btn" onClick={backToDaily}>← Today’s puzzle</button>
              </div>
            )}
            {mode === "daily" && (
              <p className="dp-next">Next puzzle in {24 - new Date().getUTCHours()}h — come back tomorrow</p>
            )}
          </div>
        )}

        {!done && (
          <div className="dp-actions">
            <button className="btn" onClick={() => { if (chain.length > 1) setChain(chain.slice(0, -1)); }} disabled={chain.length <= 1}>↩ Undo</button>
            <button className="btn" onClick={giveUp}>Give up</button>
            {mode !== "daily" && <button className="btn" onClick={backToDaily}>← Daily</button>}
          </div>
        )}

        <div className="dp-foot">
          <Link href="/">← back to the map</Link>
        </div>
      </div>
    </div>
  );
}
