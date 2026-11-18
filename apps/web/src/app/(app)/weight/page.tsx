import { redirect } from "next/navigation";

/** Weight disputes now live in Issues. */
export default function WeightPage() {
  redirect("/issues?group=WEIGHT");
}
