import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { default: "Partner app", template: "%s · D2C Logistics" } };

/** Courier staff use a phone or a laptop: one column, big buttons, no menu. */
export default function PartnerLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-2xl bg-page">{children}</div>;
}
