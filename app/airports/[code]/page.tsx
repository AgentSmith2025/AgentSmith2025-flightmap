import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAirportStats,
  getData,
  getOrigins,
  hasRoutePage,
  routeSlug,
} from "@/lib/data";

type Params = { code: string };

export function generateStaticParams(): Params[] {
  const { adj } = getData();
  return Object.keys(adj).map((code) => ({ code: code.toLowerCase() }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { code } = await params;
  const stats = getAirportStats(code.toUpperCase());
  if (!stats) return {};
  const a = stats.airport;
  return {
    title: `Direct flights from ${a.city || a.name} (${stats.code})`,
    description: `${a.name} (${stats.code}) has non-stop routes to ${stats.destinations.length} destinations in ${stats.countries.length} countries. Full list with distances.`,
  };
}

export default async function AirportPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { code } = await params;
  const stats = getAirportStats(code.toUpperCase());
  if (!stats) notFound();

  const { airport: a, destinations, countries, furthest } = stats;
  const rank =
    getOrigins().findIndex((o) => o.code === stats.code) + 1;
  const { adj } = getData();

  return (
    <main className="shell">
      <nav className="crumbs">
        <Link href="/">← map</Link> / <Link href="/airports/">airports</Link> /{" "}
        {stats.code}
      </nav>

      <p className="eyebrow">
        {a.city ? `${a.city}, ` : ""}
        {a.country}
      </p>
      <h1>
        Direct flights from <span className="accent">{a.name}</span> ({stats.code})
      </h1>
      <p className="lede">
        From {a.name} you can reach {destinations.length} destinations in{" "}
        {countries.length} {countries.length === 1 ? "country" : "countries"}{" "}
        without a connection
        {furthest
          ? ` — the longest non-stop hop is ${furthest.airport.name} at ${furthest.km.toLocaleString("en-US")} km`
          : ""}
        .
      </p>

      <div className="statband">
        <div className="stat hi">
          <div className="k">{destinations.length}</div>
          <div className="l">direct destinations</div>
        </div>
        <div className="stat">
          <div className="k">{countries.length}</div>
          <div className="l">countries reached</div>
        </div>
        <div className="stat warm">
          <div className="k">#{rank}</div>
          <div className="l">worldwide connectivity rank</div>
        </div>
      </div>

      <h2>All non-stop destinations</h2>
      <div className="desttable-wrap">
        <table className="desttable">
          <thead>
            <tr>
              <th>Code</th>
              <th>Airport</th>
              <th>Country</th>
              <th style={{ textAlign: "right" }}>Distance</th>
            </tr>
          </thead>
          <tbody>
            {destinations.map((d) => (
              <tr key={d.code}>
                <td>
                  {adj[d.code] ? (
                    <Link href={`/airports/${d.code.toLowerCase()}/`}>{d.code}</Link>
                  ) : (
                    d.code
                  )}
                </td>
                <td>
                  {d.airport.name}
                  {d.airport.city ? ` · ${d.airport.city}` : ""}
                </td>
                <td>{d.airport.country}</td>
                <td className="num">
                  {hasRoutePage(stats.code, d.code) ? (
                    <Link href={`/routes/${routeSlug(stats.code, d.code)}/`}>
                      {d.km.toLocaleString("en-US")} km
                    </Link>
                  ) : (
                    `${d.km.toLocaleString("en-US")} km`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link className="backlink" href="/">
        ← Explore on the map
      </Link>

      <p className="datanote">
        Route network built from the open OpenFlights and OurAirports datasets.
        Route existence is reliable; exact carriers and timetables change and
        are not shown here.
      </p>
    </main>
  );
}
