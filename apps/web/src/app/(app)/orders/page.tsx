import { Download, PackagePlus, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/primitives";
import { OrdersTable } from "./orders-table";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Every order from OMS Guru and bulk uploads, by status."
        actions={
          <>
            <Button variant="secondary">
              <Download size={16} /> Export
            </Button>
            <Button variant="secondary">
              <Upload size={16} /> Import from OMS Guru
            </Button>
            <Link href="/orders/new">
              <Button>
                <PackagePlus size={16} /> Add order
              </Button>
            </Link>
          </>
        }
      />
      <OrdersTable />
    </>
  );
}
