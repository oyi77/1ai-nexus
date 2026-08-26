export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import * as tokenterminal from "@/lib/tokenterminal";

const TOKEN_TERMINAL_API_KEY = process.env.TOKEN_TERMINAL_API_KEY ?? "";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get("action") ?? "projects";
  if (!TOKEN_TERMINAL_API_KEY && action !== "health") {
    return apiSuccess({ data: [], note: "TOKEN_TERMINAL_API_KEY not configured" });
  }
    const project = searchParams.get("project") ?? undefined;
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 50)));

    switch (action) {
      case "projects": {
        const data = await tokenterminal.getProjects(limit);
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
        return r;
      }

      case "top": {
        const metric = searchParams.get("metric") ?? "revenue";
        let data;
        switch (metric) {
          case "revenue":
            data = await tokenterminal.getTopProjectsByRevenue(limit);
            break;
          case "tvl":
            data = await tokenterminal.getTopProjectsByTVL(limit);
            break;
          case "users":
            data = await tokenterminal.getTopProjectsByUsers(limit);
            break;
          default:
            return apiError(`Unknown metric: ${metric}. Use: revenue, tvl, users`, 400);
        }
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
        return r;
      }

      case "project": {
        if (!project) return apiError("project parameter required", 400);
        const data = await tokenterminal.getProject(project);
        if (!data) return apiError("Project not found", 404);
        const r = apiSuccess(data);
        r.headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
        return r;
      }

      case "metrics": {
        if (!project) return apiError("project parameter required", 400);
        const data = await tokenterminal.getProjectMetrics(project, limit);
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
        return r;
      }

      case "latest": {
        const data = await tokenterminal.getLatestMetrics(limit);
        const r = apiSuccess(data, { total: data.length });
        r.headers.set("Cache-Control", "public, max-age=1800, stale-while-revalidate=3600");
        return r;
      }

      case "health": {
        const data = await tokenterminal.healthCheck();
        const r = apiSuccess(data);
        r.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return r;
      }

      default:
        return apiError(
          `Unknown action: ${action}. Use: projects, top, project, metrics, latest, health`,
          400
        );
    }
  } catch (error) {
    console.error("GET /api/v1/tokenterminal error:", error);
    return apiError("Token Terminal request failed", 502);
  }
}