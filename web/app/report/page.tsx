import type { Metadata } from "next";
import { Report } from "@/components/report/Report";

export const metadata: Metadata = {
  title: "Technical report",
  description: "Dialed's technical report: problem, architecture, the OpenCV 5 pipeline, the agent, AWS deployment, evaluation, limits and responsible use.",
};

export default function Page() {
  return <Report />;
}
