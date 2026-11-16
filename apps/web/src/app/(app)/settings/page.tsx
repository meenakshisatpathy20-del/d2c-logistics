import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Team and roles, pickup warehouses with vendor contacts, and couriers." />
      <SettingsView />
    </>
  );
}
