import type { Metadata } from "next";
import { Suspense } from "react";
import { DeskPage } from "@/components/desk/DeskPage";

export const metadata: Metadata = {
  title: "Approvals",
  description: "Work orders the agent has held, with the photo, the measurements and its reasoning. A supervisor approves or rejects each one.",
};

export default function Page() {
  return (
    <Suspense>
      <DeskPage />
    </Suspense>
  );
}
