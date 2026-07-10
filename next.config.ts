import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static export: every page is plain HTML, deployable to any
  // static host (Vercel, Cloudflare Pages, GitHub Pages) with no server.
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
