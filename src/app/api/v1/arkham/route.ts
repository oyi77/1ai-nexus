export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import * as arkham from "@/lib/arkham";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get("action") ?? "entity";
    const address = searchParams.get("address") ?? undefined;
    const chain = searchParams.get("chain") ?? "ethereum";
    const entity = searchParams.get("entity") ?? undefined;
    const query = searchParams.get("query") ?? undefined;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50)));

    switch (action) {
      case "entity": {
        if (!address) return apiError("address parameter required", 400);
        const data = await arkham.getEntity(address, chain);
        if (!data) return apiError("Entity not found", 404);
        const r = apiSuccess(data);
        r.headers.set("Cache-Control", "public, max-age=900, stale-while-revalidate=1800");
        return r;
      }

      case "portfolio": {
        if (!entity) return apiError("entity parameter required", 400);
        const data = await arkham.getPortfolio(entity);
        if (!data) return apiError("Portfolio not found", 404);
        const r = apiSuccess(data);
        r.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
        return r;
      }

      case "transfers": {
        if (!address) return apiError("address parameter required", 400);
        const data = await arkham.getTransfers(address, chain, limit);
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      case "search": {
        if (!query) return apiError("query parameter required", 400);
        const data = await arkham.searchEntities(query);
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
        return r;
      }

      case "health": {
        const data = await arkham.healthCheck();
        const r = apiSuccess(data);
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      default:
        return apiError(
          `Unknown action: ${action}. Use: entity, portfolio, transfers, search, health`,
          400
        );
    }
  } catch (error) {
    console.error("GET /api/v1/arkham error:", error);
    return apiError("Arkham request failed", 502);
  }
}