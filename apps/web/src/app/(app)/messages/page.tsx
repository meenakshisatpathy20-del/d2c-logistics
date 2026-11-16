import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { MessagesView } from "./messages-view";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage() {
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Every WhatsApp, SMS and email the platform sends: alerts to owners, escalations, the 9 pm summary and vendor pickup lists."
      />
      <MessagesView />
    </>
  );
}
