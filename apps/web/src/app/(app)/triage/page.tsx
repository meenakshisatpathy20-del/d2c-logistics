import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { TriageView } from "./triage-view";

export const metadata: Metadata = { title: "Chat triage" };

export default function TriagePage() {
  return (
    <>
      <PageHeader
        title="Chat triage"
        subtitle="Paste a courier's WhatsApp chat or upload its export. The triage agent finds every AWB, files each ask, promise and excuse on its case, and the chaser takes it from there."
      />
      <TriageView />
    </>
  );
}
