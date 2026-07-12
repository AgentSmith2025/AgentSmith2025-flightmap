# TravelIntel ✈️

**Where can you fly non-stop?** Pick any airport and see every direct flight
route out of it on an interactive night map — plus a static, SEO-friendly page
for every airport in the network.

Built on open data: [OpenFlights](https://openflights.org/data.php) routes
(ODbL) and [OurAirports](https://ourairports.com/data/) airport locations
(public domain). 3,257 airports · 67,663 directed routes.

## What's inside

| Page | What it is |
|---|---|
| `/` | Interactive canvas map — search an airport, arcs animate to every non-stop destination |
| `/airports/` | Every airport ranked by number of direct destinations |
| `/airports/dus/` | Per-airport page (×3,241): stats, connectivity rank, full destination table |

The world map is drawn from the airport coordinates themselves — no map tiles,
no external services, fully self-contained.

## Develop

```bash
npm install
npm run dev        # prepare-data runs automatically before build
```

## Build & deploy

```bash
npm run build      # static export -> out/
```

The build is a **fully static site** (`output: "export"`): deploy the `out/`
directory to Vercel, Cloudflare Pages, Netlify, or GitHub Pages — no server
needed. Set `NEXT_PUBLIC_SITE_URL` to your production URL so the sitemap is
generated with correct absolute links.

## Data pipeline

`scripts/prepare-data.mjs` parses the raw OpenFlights `.dat` files in `data/`
into a single `flight-data.json` consumed both by the SSG pages (at build
time) and the interactive map (fetched client-side). Re-run with
`npm run prepare-data` after updating the `.dat` files.

**Data honesty note:** the OpenFlights route snapshot is reliable for *network
shape* (which airports connect) but its airline/schedule details are dated.
The site deliberately shows route existence, distances, and connectivity
stats — not carriers or timetables.

## License

Code: MIT. Route data: [ODbL](https://opendatacommons.org/licenses/odbl/1-0/)
(OpenFlights) — derived data in this repo remains under that license.
Airport data: public domain (OurAirports).
