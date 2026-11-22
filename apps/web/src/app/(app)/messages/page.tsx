import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { MessagesView } from "./messages-view";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage() {
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Every SMS link and email the platform sends. No WhatsApp: partners answer in their own app; SMS only carries the link."
      />
      <MessagesView />
    </>
  );
}
