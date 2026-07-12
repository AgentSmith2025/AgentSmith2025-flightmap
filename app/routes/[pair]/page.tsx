import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  estFlightTime,
  getAirportStats,
  getRouteDetails,
  getRoutePairs,
  hasRoutePage,
  routeSlug,
} from "@/lib/data";

type Params = { pair: string };

export function generateStaticParams(): Params[] {
  return getRoutePairs().map((p) => ({ pair: p.toLowerCase() }));
}

export const dynamicParams = false;

function parsePair(pair: string): [string, string] | null {
  const m = /^([a-z0-9]{3})-([a-z0-9]{3})$/.exec(pair);
  if (!m) return null;
  return [m[1].toUpperCase(), m[2].toUpperCase()];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { pair } = await params;
  const codes = parsePair(pair);
  if (!codes) return {};
  const r = getRouteDetails(codes[0], codes[1]);
  if (!r) return {};
  const cityA = r.A.city || r.A.name;
  const cityB = r.B.city || r.B.name;
  return {
    title: `${cityA} to ${cityB} flights: ${r.a} – ${r.b}`,
    description: `Non-stop flights between ${r.A.name} (${r.a}) and ${r.B.name} (${r.b}): ${r.km.toLocaleString("en-US")} km, about ${estFlightTime(r.km)} in the air. Route details and connections.`,
  };
}

export default async function RoutePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { pair } = await params;
  const codes = parsePair(pair);
  if (!codes) notFound();
  const r = getRouteDetails(codes[0], codes[1]);
  if (!r) notFound();

  const statsA = getAirportStats(r.a);
  const statsB = getAirportStats(r.b);
  const time = estFlightTime(r.km);

  const direction =
    r.abDirect && r.baDirect
      ? "both directions"
      : r.abDirect
        ? `${r.a} → ${r.b} only`
        : `${r.b} → ${r.a} only`;

  const related = (
    stats: NonNullable<typeof statsA>,
    exclude: string,
  ) =>
    stats.destinations
      .filter((d) => d.code !== exclude && hasRoutePage(stats.code, d.code))
      .slice(0, 8);

  return (
    <main className="shell">
      <nav className="crumbs">
        <Link href="/">← map</Link> / <Link href="/airports/">airports</Link> /{" "}
        {r.a}–{r.b}
      </nav>

      <p className="eyebrow">
        {r.A.country === r.B.country
          ? r.A.country
          : `${r.A.country} ↔ ${r.B.country}`}
      </p>
      <h1>
        <span className="accent">{r.A.city || r.A.name}</span> to{" "}
        <span className="accent">{r.B.city || r.B.name}</span> by direct flight
      </h1>
      <p className="lede">
        {r.A.name} ({r.a}) and {r.B.name} ({r.b}) are connected non-stop —{" "}
        {r.km.toLocaleString("en-US")} km apart, roughly {time} in the air,
        served {direction === "both directions" ? "in both directions" : `in one direction (${direction})`}.
      </p>

      <div className="statband">
        <div className="stat hi">
          <div className="k">{r.km.toLocaleString("en-US")}</div>
          <div className="l">km, great-circle</div>
        </div>
        <div className="stat">
          <div className="k">{time}</div>
          <div className="l">estimated flight time</div>
        </div>
        <div className="stat warm">
          <div className="k">{r.abDirect && r.baDirect ? "A ⇄ B" : "A → B"}</div>
          <div className="l">{direction}</div>
        </div>
      </div>

      <p style={{ marginTop: 18 }}>
        <Link href={`/?from=${r.a}&to=${r.b}`}>
          → Open this route in the interactive map
        </Link>
      </p>

      <h2>The two airports</h2>
      <div className="desttable-wrap">
        <table className="desttable">
          <thead>
            <tr>
              <th>Airport</th>
              <th>City</th>
              <th>Country</th>
              <th style={{ textAlign: "right" }}>Direct destinations</th>
            </tr>
          </thead>
          <tbody>
            {[
              { code: r.a, apt: r.A, stats: statsA },
              { code: r.b, apt: r.B, stats: statsB },
            ].map(({ code, apt, stats }) => (
              <tr key={code}>
                <td>
                  <Link href={`/airports/${code.toLowerCase()}/`}>{code}</Link>{" "}
                  {apt.name}
                </td>
                <td>{apt.city}</td>
                <td>{apt.country}</td>
                <td className="num">{stats?.destinations.length ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {statsA && related(statsA, r.b).length > 0 && (
        <>
          <h2>More routes from {r.A.city || r.a}</h2>
          <ul className="hublist">
            {related(statsA, r.b).map((d) => (
              <li key={d.code}>
                <Link href={`/routes/${routeSlug(r.a, d.code)}/`}>
                  <span className="code">{r.a}–{d.code}</span>
                  <span className="nm">{d.airport.city || d.airport.name}</span>
                  <span className="rt">{d.km.toLocaleString("en-US")} km</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {statsB && related(statsB, r.a).length > 0 && (
        <>
          <h2>More routes from {r.B.city || r.b}</h2>
          <ul className="hublist">
            {related(statsB, r.a).map((d) => (
              <li key={d.code}>
                <Link href={`/routes/${routeSlug(r.b, d.code)}/`}>
                  <span className="code">{r.b}–{d.code}</span>
                  <span className="nm">{d.airport.city || d.airport.name}</span>
                  <span className="rt">{d.km.toLocaleString("en-US")} km</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link className="backlink" href="/">
        ← Explore on the map
      </Link>

      <p className="datanote">
        Route network built from the open OpenFlights and OurAirports datasets.
        Flight time is a distance-based estimate; carriers and timetables
        change and are not shown here — verify schedules before booking.
      </p>
    </main>
  );
}
