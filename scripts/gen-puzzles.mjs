// Generates a stable year of "Daily Hop" puzzles from the route network.
// Deterministic (fixed seed) so a given calendar day maps to the same puzzle
// across rebuilds. Output: public/daily-puzzles.json + data/daily-puzzles.json
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { airports, adj } = JSON.parse(
  readFileSync(join(root, "data", "flight-data.json"), "utf8"),
);

const deg = (c) => (adj[c] || []).length;

// Endpoints: recognizable hubs. Intermediates: any airport in the network.
const majors = Object.keys(adj).filter((c) => airports[c] && deg(c) >= 35);

// shortest hop count + one example shortest path
function solve(src, dst) {
  if (src === dst) return { par: 0, via: [] };
  const dist = { [src]: 0 };
  const prev = {};
  let frontier = [src];
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const next = [];
    for (const u of frontier) {
      for (const v of adj[u] || []) {
        if (!(v in dist)) {
          dist[v] = dist[u] + 1;
          prev[v] = u;
          if (v === dst) {
            const path = [dst];
            let x = dst;
            while (prev[x] !== undefined) { x = prev[x]; path.unshift(x); }
            return { par: dist[dst], via: path.slice(1, -1) };
          }
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  return { par: 99, via: [] };
}

// deterministic PRNG (mulberry32)
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260714);
const pick = () => majors[(rand() * majors.length) | 0];

const puzzles = [];
const seen = new Set();
let guard = 0;
// mix of difficulties: mostly 2-hop, a third 3-hop
while (puzzles.length < 366 && guard < 60000) {
  guard++;
  const from = pick();
  const to = pick();
  if (from === to) continue;
  const key = [from, to].sort().join("-");
  if (seen.has(key)) continue;
  const { par, via } = solve(from, to);
  if (par !== 2 && par !== 3) continue;
  // keep ~65% 2-hop for approachability
  if (par === 3 && rand() > 0.4) continue;
  seen.add(key);
  puzzles.push({
    from,
    to,
    par,
    via,
    fromCity: airports[from].city || airports[from].name,
    toCity: airports[to].city || airports[to].name,
    fromCountry: airports[from].country,
    toCountry: airports[to].country,
  });
}

const json = JSON.stringify(puzzles);
writeFileSync(join(root, "public", "daily-puzzles.json"), json);
writeFileSync(join(root, "data", "daily-puzzles.json"), json);
const two = puzzles.filter((p) => p.par === 2).length;
console.log(`gen-puzzles: ${puzzles.length} puzzles (${two} 2-hop, ${puzzles.length - two} 3-hop)`);
console.log("sample:", puzzles.slice(0, 3).map((p) => `${p.fromCity}→${p.toCity} (par ${p.par})`).join(" · "));
