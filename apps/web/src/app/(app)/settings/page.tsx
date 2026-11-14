import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Team, pickup warehouses and couriers." />
      <SettingsView />
    </>
  );
}
