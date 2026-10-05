import type { Metadata } from "next";
import { RoundPage } from "@/components/round/RoundPage";

export const metadata: Metadata = {
  title: "The round",
  description: "Walk the sample round through a water-works pump house: photograph each gauge and watch the agent log it, ask for a new photo, or hold a work order.",
};

export default function Page() {
  return <RoundPage />;
}
