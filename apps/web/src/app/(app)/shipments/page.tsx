import { redirect } from "next/navigation";

/** The journey board now lives inside Orders as "Board view". */
export default function ShipmentsPage() {
  redirect("/orders?view=board");
}
