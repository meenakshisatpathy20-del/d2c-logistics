"use client";

import { FileUp } from "lucide-react";
import { useShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/primitives";

export function NewShipmentButton() {
  const { openBooking } = useShell();
  return (
    <Button variant="secondary" onClick={openBooking}>
      <FileUp size={16} /> Import or bulk book
    </Button>
  );
}
