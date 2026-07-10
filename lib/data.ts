import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Airport = {
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
};

export type FlightData = {
  airports: Record<string, Airport>;
  adj: Record<string, string[]>;
};

let cached: FlightData | null = null;

export function getData(): FlightData {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(join(process.cwd(), "data", "flight-data.json"), "utf8"),
    ) as FlightData;
  }
  return cached;
}

export function haversineKm(a: Airport, b: Airport): number {
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

export type AirportStats = {
  code: string;
  airport: Airport;
  destinations: { code: string; airport: Airport; km: number }[];
  countries: string[];
  furthest: { code: string; airport: Airport; km: number } | null;
};

export function getAirportStats(code: string): AirportStats | null {
  const { airports, adj } = getData();
  const airport = airports[code];
  const dests = adj[code];
  if (!airport || !dests) return null;

  const destinations = dests
    .filter((d) => airports[d])
    .map((d) => ({
      code: d,
      airport: airports[d],
      km: Math.round(haversineKm(airport, airports[d])),
    }))
    .sort((a, b) => b.km - a.km);

  const countries = [...new Set(destinations.map((d) => d.airport.country))].sort();

  return {
    code,
    airport,
    destinations,
    countries,
    furthest: destinations[0] ?? null,
  };
}

/** All origin airports, sorted by route count (descending). */
export function getOrigins(): { code: string; airport: Airport; routes: number }[] {
  const { airports, adj } = getData();
  return Object.entries(adj)
    .filter(([code]) => airports[code])
    .map(([code, dests]) => ({ code, airport: airports[code], routes: dests.length }))
    .sort((a, b) => b.routes - a.routes);
}
