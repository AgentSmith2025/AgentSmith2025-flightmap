import type { Metadata } from "next";
import Link from "next/link";
import { getOrigins } from "@/lib/data";

export const metadata: Metadata = {
  title: "All airports by direct connections",
  description:
    "Every airport in the network ranked by number of non-stop destinations. See where you can fly direct from any airport in the world.",
};

export default function AirportsIndex() {
  const origins = getOrigins();
  const top = origins.slice(0, 60);
  const rest = origins.slice(60);

  return (
    <main className="shell">
      <nav className="crumbs">
        <Link href="/">← map</Link> / airports
      </nav>
      <p className="eyebrow">Airport index</p>
      <h1>
        {origins.length.toLocaleString("en-US")} airports,{" "}
        <span className="accent">ranked by reach</span>
      </h1>
      <p className="lede">
        Every airport with scheduled departures in the network, ordered by how
        many destinations you can reach without a connection.
      </p>

      <h2>Top hubs</h2>
      <ul className="hublist">
        {top.map((o) => (
          <li key={o.code}>
            <Link href={`/airports/${o.code.toLowerCase()}/`}>
              <span className="code">{o.code}</span>
              <span className="nm">{o.airport.name}</span>
              <span className="rt">{o.routes} dests</span>
            </Link>
          </li>
        ))}
      </ul>

      <h2>Everything else</h2>
      <ul className="hublist">
        {rest.map((o) => (
          <li key={o.code}>
            <Link href={`/airports/${o.code.toLowerCase()}/`}>
              <span className="code">{o.code}</span>
              <span className="nm">{o.airport.name}</span>
              <span className="rt">{o.routes}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="datanote">
        Route network built from the open OpenFlights and OurAirports datasets.
        Route existence is reliable; exact carriers and timetables change and
        are not shown here.
      </p>
    </main>
  );
}
