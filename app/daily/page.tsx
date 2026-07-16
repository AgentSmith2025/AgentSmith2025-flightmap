import type { Metadata } from "next";
import DailyPuzzle from "@/components/DailyPuzzle";

export const metadata: Metadata = {
  title: "Daily Hop — the flight-route puzzle",
  description:
    "A new flight puzzle every day: connect two cities in as few flights as possible. Build your streak and share your result.",
};

export default function DailyPage() {
  return <DailyPuzzle />;
}
