export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";

import { apiSuccess, apiError } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const chain = searchParams.get("chain");
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 100)));

    const where: Record<string, unknown> = {};
    const address = searchParams.get("address");
    if (address) where.wallet = { address: address.toLowerCase() };
    if (chain) where.chain = chain;

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit + 1,
      include: {
        wallet: { select: { address: true, entityId: true, entity: { select: { name: true, type: true } } } },
      },
    });

    const hasMore = transactions.length > limit;
    const sliced = hasMore ? transactions.slice(0, limit) : transactions;

    // Aggregate flows by wallet
    const flowMap = new Map<string, { wallet: string; entity: string; totalUsd: number; count: number }>();
    for (const tx of sliced) {
      const entity = tx.wallet?.entity?.name ?? tx.wallet?.address?.slice(0, 10) ?? 'Unknown'
      const key = tx.walletId ?? tx.txHash
      const existing = flowMap.get(key)
      if (existing) {
        existing.totalUsd += tx.value
        existing.count++
      } else {
        flowMap.set(key, { wallet: tx.wallet?.address ?? 'Unknown', entity, totalUsd: tx.value, count: 1 })
      }
    }

    const flows = Array.from(flowMap.values()).sort((a, b) => b.totalUsd - a.totalUsd);

    const r = apiSuccess(flows, { pageSize: flows.length, hasMore })
    r.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
    return r
  } catch (error) {
    console.error("GET /api/v1/flows error:", error);
    return apiError("Internal server error", 500);
  }
}
