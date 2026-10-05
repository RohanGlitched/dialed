import type { Metadata } from "next";
import { ReadPage } from "@/components/inspect/ReadPage";

export const metadata: Metadata = {
  title: "Read a gauge",
  description: "Upload a photo of an analog gauge, or use the live camera guide. See every stage OpenCV 5 went through to read it.",
};

export default function Page() {
  return <ReadPage />;
}
