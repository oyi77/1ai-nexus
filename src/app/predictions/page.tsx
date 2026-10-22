import { ForecastHub } from "@/lib/predictions/forecast-hub"

export default async function PredictionsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const params = await searchParams
  return <ForecastHub initialTab={params.tab} />
}
