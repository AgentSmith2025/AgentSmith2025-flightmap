import type { MetadataRoute } from "next";
import { getData, getRoutePairs } from "@/lib/data";

export const dynamic = "force-static";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://flightmap.example.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const { adj } = getData();
  return [
    { url: `${BASE}/`, priority: 1 },
    { url: `${BASE}/airports/`, priority: 0.8 },
    ...Object.keys(adj).map((code) => ({
      url: `${BASE}/airports/${code.toLowerCase()}/`,
      priority: 0.6,
    })),
    ...getRoutePairs().map((pair) => ({
      url: `${BASE}/routes/${pair.toLowerCase()}/`,
      priority: 0.5,
    })),
  ];
}
