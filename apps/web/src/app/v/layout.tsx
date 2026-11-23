import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { default: "Vendor pickups", template: "%s · EcomNext" } };

/** Vendor partners use their phone: one narrow column, big buttons, no menu. */
export default function VendorLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-md bg-page">{children}</div>;
}
