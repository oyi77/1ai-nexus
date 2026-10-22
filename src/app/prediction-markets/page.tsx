import { redirect } from "next/navigation"

export default function PredictionMarketsRedirect() {
  redirect("/predictions?tab=markets")
}
