import { type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { apiSuccess, apiError } from "@/lib/api/response";
import { verifyToken } from "@/lib/jwt";
import { AlertCondition } from "@/lib/alerts/schemas";
import { createAlert, getAlerts, toggleAlert, deleteAlert, type Alert as EngineAlert } from "@/lib/modules/derived/alert-engine";
import { awardXp } from "@/lib/gamification";

export const runtime = "nodejs";

interface AlertPageShape {
  id: string;
  type: string;
  name: string;
  description: string;
  channel: string;
  enabled: boolean;
  lastTriggered: string | null;
  config: Record<string, unknown>;
}

function buildDescription(type: string, config: Record<string, unknown>): string {
  switch (type) {
    case "price_threshold":
      return `${config.symbol} ${config.direction} $${config.threshold}`;
    case "forex_rate":
      return `${config.pair} ${config.direction} ${config.threshold}`;
    case "macro_event":
      return `${config.event}${config.country ? ` (${config.country})` : ""}`;
    case "wallet_moved":
      return `Whale > $${Number(config.minAmountUsd ?? 0).toLocaleString()}`;
    case "smart_money_action":
      return `Smart money: ${config.action}`;
    case "prediction_threshold":
      return `Market ${config.marketId} ${config.direction} ${config.threshold}`;
    case "conviction_threshold":
      return `${config.symbol} conviction ${config.direction} ${config.threshold}`;
    default:
      return type;
  }
}

function engineToPage(alert: EngineAlert): AlertPageShape {
  const conditions = (alert.conditions as Record<string, unknown>) ?? {};
  return {
    id: alert.id,
    type: alert.triggerType ?? "manual",
    name: alert.name ?? alert.triggerType ?? "Alert",
    description: alert.condition ?? "",
    channel: (conditions.channel as string) ?? "telegram",
    enabled: alert.enabled,
    lastTriggered: alert.lastFired ? new Date(alert.lastFired).toISOString() : null,
    config: (conditions.config as Record<string, unknown>) ?? {},
  };
}

/**
 * Resolve the authenticated user id from the Bearer token or the
 * nexus-session cookie (same pattern as /api/v1/account/me).
 * Returns null when unauthenticated.
 */
async function requireUser(request: NextRequest): Promise<string | null> {
  let token: string | undefined;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    token = request.cookies.get("nexus-session")?.value;
  }
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload?.userId) return null;
  return payload.userId;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    if (!userId) return apiError("Authentication required", 401);

    const { searchParams } = request.nextUrl;
    const active = searchParams.get("active");
    const alerts = (await getAlerts())
      .filter((a) => a.userId === userId)
      .map(engineToPage);
    const filtered = active === null ? alerts : alerts.filter((a) => a.enabled === (active === "true"));
    return apiSuccess(filtered);
  } catch (error) {
    console.error("GET /api/v1/alerts error:", error);
    return apiError("Internal server error", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    if (!userId) return apiError("Authentication required", 401);

    const body = await request.json();
    const { type, name, config, channel, webhookUrl, webhookSecret } = body as {
      type?: string;
      name?: string;
      config?: Record<string, unknown>;
      channel?: string;
      webhookUrl?: string;
      webhookSecret?: string;
    };

    if (!type) return apiError("Missing required field: type", 400);
    if (!config || typeof config !== "object") return apiError("Missing required field: config", 400);

    const parsed = AlertCondition.safeParse({ type, ...config });
    if (!parsed.success) {
      return apiError(`Invalid alert config: ${parsed.error.issues.map((i) => i.message).join(", ")}`, 400);
    }

    const created = await createAlert({
      id: "",
      userId,
      triggerType: type,
      conditions: { config, channel: channel ?? "telegram" } as Prisma.InputJsonValue,
      name: name ?? type,
      condition: buildDescription(type, config),
      webhookUrl,
      webhookSecret,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Reward saving a watchlist alert (idempotent per alert).
    void awardXp(userId, "SAVE_WATCHLIST", `alert:${created.id}`).catch((err) => {
      console.error("SAVE_WATCHLIST XP award error:", err);
    });

    return apiSuccess(engineToPage(created));
  } catch (error) {
    console.error("POST /api/v1/alerts error:", error);
    return apiError((error as Error).message || "Internal server error", 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    if (!userId) return apiError("Authentication required", 401);

    const body = await request.json();
    const { id } = body as { id?: string };
    if (!id) return apiError("Missing required field: id", 400);

    const owned = (await getAlerts()).some((a) => a.id === id && a.userId === userId);
    if (!owned) return apiError("Alert not found", 404);

    const updated = await toggleAlert(id);
    if (!updated) return apiError("Alert not found", 404);

    return apiSuccess(engineToPage(updated));
  } catch (error) {
    console.error("PATCH /api/v1/alerts error:", error);
    return apiError("Internal server error", 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireUser(request);
    if (!userId) return apiError("Authentication required", 401);

    const id = request.nextUrl.searchParams.get("id");
    if (!id) return apiError("Missing required param: id", 400);

    const owned = (await getAlerts()).some((a) => a.id === id && a.userId === userId);
    if (!owned) return apiError("Alert not found", 404);

    const deleted = await deleteAlert(id);
    if (!deleted) return apiError("Alert not found", 404);

    return apiSuccess({ deleted: id });
  } catch (error) {
    console.error("DELETE /api/v1/alerts error:", error);
    return apiError("Internal server error", 500);
  }
}
