import type { Metadata } from "next";
import { EvidencePage } from "@/components/evidence/EvidencePage";

export const metadata: Metadata = {
  title: "Evidence",
  description: "Accuracy on held-out gauges, confidence calibration, failure cases, agent scenario tests and DNN engine timings, with the commands to reproduce them.",
};

export default function Page() {
  return <EvidencePage />;
}
