// Parses OpenFlights .dat files into the JSON the app consumes.
// Run automatically via `npm run prepare-data` (prebuild).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal CSV parser that handles quoted fields (the .dat files use them).
function parseCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function readDat(file) {
  return readFileSync(join(root, "data", file), "utf8")
    .split("\n").filter(Boolean).map(parseCsvLine);
}

// --- airports: IATA -> {name, city, country, lat, lon} ---
const airports = {};
for (const r of readDat("airports.dat")) {
  if (r.length < 8) continue;
  const iata = r[4];
  if (!iata || iata === "\\N") continue;
  const lat = parseFloat(r[6]), lon = parseFloat(r[7]);
  if (!isFinite(lat) || !isFinite(lon)) continue;
  airports[iata] = {
    name: r[1].replace(/ Airport$/, ""),
    city: r[2],
    country: r[3],
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
  };
}

// --- routes: adjacency src -> [dst...] (direct only, valid airports only) ---
const adjSet = {};
for (const r of readDat("routes.dat")) {
  if (r.length < 5) continue;
  const src = r[2], dst = r[4];
  if (src === dst || !airports[src] || !airports[dst]) continue;
  (adjSet[src] ??= new Set()).add(dst);
}

// Keep only airports that appear in the network.
const used = new Set(Object.keys(adjSet));
for (const dests of Object.values(adjSet)) for (const d of dests) used.add(d);

const outAirports = {};
for (const code of used) outAirports[code] = airports[code];
const adj = {};
for (const [src, dests] of Object.entries(adjSet)) adj[src] = [...dests].sort();

const data = { airports: outAirports, adj };
const json = JSON.stringify(data);

mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public", "flight-data.json"), json);       // fetched by the map
writeFileSync(join(root, "data", "flight-data.json"), json);          // read by SSG pages

console.log(
  `prepared: ${Object.keys(outAirports).length} airports, ` +
  `${Object.keys(adj).length} origins, ` +
  `${Object.values(adj).reduce((n, d) => n + d.length, 0)} directed routes, ` +
  `${Math.round(json.length / 1024)} KB`
);
