import { redirect } from "next/navigation";

/** Failed deliveries and returns now live in Issues. */
export default function NdrPage() {
  redirect("/issues?group=DELIVERY");
}
