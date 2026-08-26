export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import * as thegraph from "@/lib/thegraph";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get("action") ?? "uniswap";
    const chain = searchParams.get("chain") ?? "ethereum";
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));

    switch (action) {
      case "uniswap": {
        const validChains = ["ethereum", "arbitrum", "base", "optimism", "polygon"] as const;
        const c = validChains.includes(chain as typeof validChains[number]) ? (chain as typeof validChains[number]) : "ethereum";
        const data = await thegraph.getUniswapV3Pools(c, limit);
        if (!data) return apiSuccess({ unavailable: true, note: "The Graph API is unreachable from this host" });
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      case "aave": {
        const validChains = ["ethereum", "arbitrum", "base"] as const;
        const c = validChains.includes(chain as typeof validChains[number]) ? (chain as typeof validChains[number]) : "ethereum";
        const data = await thegraph.getAaveV3Reserves(c, limit);
        if (!data) return apiSuccess({ unavailable: true, note: "The Graph API is unreachable from this host" });
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      case "gmx": {
        const validChains = ["ethereum", "arbitrum"] as const;
        const c = validChains.includes(chain as typeof validChains[number]) ? (chain as typeof validChains[number]) : "arbitrum";
        const data = await thegraph.getGMXMarkets(c);
        if (!data) return apiSuccess({ unavailable: true, note: "The Graph API is unreachable from this host" });
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      case "lido": {
        const data = await thegraph.getLidoData();
        if (!data) return apiSuccess({ unavailable: true, note: "The Graph API is unreachable from this host" });
        const r = apiSuccess(data);
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      case "curve": {
        const data = await thegraph.getCurvePools(limit);
        if (!data) return apiSuccess({ unavailable: true, note: "The Graph API is unreachable from this host" });
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      case "top-defi": {
        const data = await thegraph.getTopDeFiMetrics();
        if (!data) return apiSuccess({ unavailable: true, note: "The Graph API is unreachable from this host" });
        const r = apiSuccess(data);
        r.headers.set("Cache-Control", "public, max-age=600, stale-while-revalidate=1200");
        return r;
      }

      case "query": {
        const subgraph = searchParams.get("subgraph") ?? "uniswapV3Ethereum";
        const query = searchParams.get("query");
        if (!query) return apiError("query parameter required", 400);
        const variablesParam = searchParams.get("variables");
        const variables = variablesParam ? JSON.parse(variablesParam) : undefined;
        const data = await thegraph.querySubgraph(subgraph, query, variables);
        if (!data) return apiSuccess({ unavailable: true, note: "The Graph API is unreachable from this host" });
        const r = apiSuccess(data);
        r.headers.set("Cache-Control", "public, max-age=120, stale-while-revalidate=240");
        return r;
      }

      case "health": {
        const data = await thegraph.healthCheck();
        const r = apiSuccess(data);
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      default:
        return apiError(
          `Unknown action: ${action}. Use: uniswap, aave, gmx, lido, curve, top-defi, query, health`,
          400
        );
    }
  } catch (error) {
    console.error("GET /api/v1/thegraph error:", error);
    return apiError("The Graph request failed", 502);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subgraph, query, variables } = body;

    if (!subgraph || !query) {
      return apiError("subgraph and query required", 400);
    }

    const data = await thegraph.querySubgraph(subgraph, query, variables);
    if (!data) return apiSuccess({ unavailable: true, note: "The Graph API is unreachable from this host" });

    const r = apiSuccess(data);
    r.headers.set("Cache-Control", "public, max-age=120, stale-while-revalidate=240");
    return r;
  } catch (error) {
    console.error("POST /api/v1/thegraph error:", error);
    return apiError("The Graph request failed", 502);
  }
}