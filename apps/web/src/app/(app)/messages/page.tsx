import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { MessagesView } from "./messages-view";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage() {
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Every message the platform and the agent send. Partners answer in the partner app today; WhatsApp replies join here once the business number is approved."
      />
      <MessagesView />
    </>
  );
}
