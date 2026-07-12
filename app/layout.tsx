import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travelintel.pages.dev";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "TravelIntel — where can you fly non-stop?",
    template: "%s · TravelIntel",
  },
  description:
    "Pick any airport and see every direct flight route out of it on an interactive night map. 3,000+ airports, 37,000+ routes, built on open flight data.",
  openGraph: {
    siteName: "TravelIntel",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
