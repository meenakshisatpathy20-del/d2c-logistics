import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentChat } from "./agent-chat";

export const metadata: Metadata = { title: "Ops agent" };

export default function AgentPage() {
  return (
    <Suspense>
      <AgentChat />
    </Suspense>
  );
}
