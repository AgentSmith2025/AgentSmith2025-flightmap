# Vision — from flight map to travel orchestrator

*Last updated: 2026-07-11*

## The problem

Travel planning is fragmented. Even with dozens of services available, one trip
means juggling a flight site, FlixBus, a train site, Booking.com, a car rental
desk, and an attractions app — each with its own account, its own confirmation
email, its own app. The nightmare isn't the lack of services; it's that the
traveler is the integration layer.

## What this project is (and isn't)

**It is:** one place that collects the data, understands the whole journey,
and makes it convenient — the system suggests, the user decides.

**It is not:** another ticket seller. Revenue (affiliate links, later
partnerships) funds the project; selling is never the product. Convenience is.

## The four layers

The end state stacks four capabilities. Each layer is useful on its own and
each one makes the next possible:

| # | Layer | What it means | Example |
|---|-------|---------------|---------|
| 1 | **Aggregate** | All transport modes + hotels + attractions in one view | Flight DUS→VLC, or bus + train + flight combined when that's smarter |
| 2 | **Suggest** | The system reads the journey and proposes what the user would have had to figure out | "Driving 11h? Stop in Lyon — these 3 hotels are on your route." "You land at 22:40 — this hotel is 400 m from the station." |
| 3 | **Orchestrate** | An AI agent places the bookings on the user's behalf, everywhere | User approves the plan once; the agent books the flight, hotel, and bus |
| 4 | **Consolidate** | Everything lands in one itinerary — one file with every ticket, voucher, and time | A single PDF/wallet with the whole trip in order |

Layer 4 looks boring but may be the most loved feature: the pain people name
is fragmentation *after* booking.

## Staged roadmap

Audience-first: ship the flight product, watch traffic, and let real numbers
unlock the next stage (including free/partner API access — data providers say
yes to sites with visitors, not to ideas).

### Stage 1 — Flights (LIVE)
- Interactive route map: pick an origin, see every non-stop destination
- From→To search incl. connecting flights (fewest-hop BFS over the network)
- 3,241 SEO airport pages with connectivity stats and rank
- **Data:** OpenFlights routes (ODbL) + OurAirports coordinates (public
  domain). Free, static, reliable for network shape; carriers/timetables
  deliberately not shown (dataset is dated there).
- **Cost: $0.** Hosting: Cloudflare Pages free tier.

### Stage 1.5 — Audience building (next)
- Google Search Console + sitemap submission; Cloudflare Web Analytics
- Route pages (`/routes/dus-vlc/`) — multiplies indexed SEO surface ~10×
- Shareable hooks: daily route puzzle ("A to B in fewest flights"),
  per-airport "flight world" share cards, connectivity leaderboards
- **Goal:** a measurable trickle of organic traffic; the numbers that open
  partner doors.

### Stage 2 — Car + smart stops
- Driving routes via OSRM / OpenRouteService (OpenStreetMap, free)
- The differentiator: journey logic — driving time > 8h triggers overnight
  stop suggestions with hotels along the corridor (Booking.com / Amadeus
  affiliate APIs: free to integrate, commission-paying)
- First revenue without selling anything: affiliate links.

### Stage 3 — Trains & buses
- Hardest data problem: fragmented per country. Open GTFS feeds, Transitous,
  national rail APIs where available; FlixBus etc. via partnerships once
  traffic justifies them.
- Multi-modal combining is the same BFS idea as flights, run across the
  merged graph of all modes.

### Stage 4 — Suggest engine
- Arrival-aware hotel suggestions, interest-based attractions (OpenTripMap /
  Wikidata to start), day-by-day plan assembly.

### Stage 5 — Orchestrate + consolidate
- AI agent executes the approved plan: places bookings on the user's behalf
  (agentic booking APIs are emerging industry-wide — being positioned here
  early, with an audience, is the bet)
- Output: one consolidated itinerary file — every booking, voucher, and time
  in a single document.

## Principles

1. **Convenience is the product.** Every feature is judged by "does this
   remove a tab the traveler would otherwise open?"
2. **Free data first, paid data when traffic pays for it.** Never block a
   stage on a paid dependency that a free approximation can cover.
3. **Ship small, measure, let the audience unlock the next stage.** No
   one-shot moonshot builds.
4. **Honesty about data quality.** Where the data is approximate (e.g. no
   timetables in Stage 1), say so on the page rather than pretending.
5. **The user approves; the system executes.** Suggestions and agents never
   book without an explicit yes.

## Current status

- **Live:** https://agentsmith2025-flightmap.pages.dev (Cloudflare Pages,
  auto-deploys from `main`)
- **Stage:** 1 complete, 1.5 starting
- **Stack:** Next.js 16 static export · open data pipeline in
  `scripts/prepare-data.mjs` · zero servers, zero runtime cost
