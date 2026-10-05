import type { Metadata } from "next";
import { Suspense } from "react";
import { GaugePage } from "@/components/gauge/GaugePage";

export const metadata: Metadata = {
  title: "Gauge sheet",
  description: "One gauge's week on a circular chart, its reading log, every photo straightened, and its registration.",
};

export default function Page() {
  return (
    <Suspense>
      <GaugePage />
    </Suspense>
  );
}
