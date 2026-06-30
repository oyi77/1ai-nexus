export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api/response";
import { evaluateCondition, type NexusEvent } from "@/lib/alerts/evaluator";
import { fireAlert } from "@/lib/modules/derived/alert-engine";
import { AlertCondition } from "@/lib/alerts/schemas";
import { registerAllModules } from "@/lib/modules";

interface CalendarApiResponse {
  data?: {
    events?: Array<{ date: string; event: string; country: string }>
  }
}

export async function GET(request: NextRequest) {
  try {
    const dbAlerts = await prisma.alert.findMany({ where: { isActive: true } });
    if (dbAlerts.length === 0) {
      return apiSuccess({ evaluated: 0, triggered: 0, results: [] });
    }

    const today = new Date().toISOString().slice(0, 10);
    const origin = request.nextUrl.origin;
    const calendarEvents = await fetch(`${origin}/api/v1/calendar`)
      .then((r) => r.json() as Promise<CalendarApiResponse>)
      .then((j) => j.data?.events ?? [])
      .catch(() => [] as Array<{ date: string; event: string; country: string }>);

    const results: Array<{ id: string; type: string; triggered: boolean; message: string; fired: boolean; deliveryStatus: string; deliveryError?: string }> = [];
    let triggered = 0;

    for (const dbAlert of dbAlerts) {
      const type = dbAlert.triggerType;
      const conditions = (dbAlert.conditions as Record<string, unknown>) ?? {};
      const config = (conditions.config as Record<string, unknown>) ?? {};

      const parsed = AlertCondition.safeParse({ type, ...config });
      if (!parsed.success) {
        results.push({ id: dbAlert.id, type, triggered: false, message: `Invalid config: ${parsed.error.issues.map((i) => i.message).join(", ")}`, fired: false, deliveryStatus: 'skipped' });
        continue;
      }

      try {
        const event = await fetchEventForAlert(type, config, calendarEvents, today);
        if (!event) {
          results.push({ id: dbAlert.id, type, triggered: false, message: "No event data available", fired: false, deliveryStatus: 'skipped' });
          continue;
        }

        const isTriggered = evaluateCondition(parsed.data, event);
        if (isTriggered) {
          triggered++;
          const message = buildTriggerMessage(type, config, event);
          const fireResult = await fireAlert(dbAlert.id, event, message).catch((e) => {
            console.error(`[ALERT] Failed to fire alert ${dbAlert.id}:`, e)
            return { fired: false, deliveryStatus: 'failed', deliveryError: (e as Error).message } as const
          })
          results.push({
            id: dbAlert.id,
            type,
            triggered: true,
            message,
            fired: fireResult.fired,
            deliveryStatus: fireResult.deliveryStatus,
            deliveryError: fireResult.deliveryError,
          })
        } else {
          results.push({ id: dbAlert.id, type, triggered: false, message: "Condition not met", fired: false, deliveryStatus: 'skipped' })
        }
      } catch (e) {
        results.push({ id: dbAlert.id, type, triggered: false, message: `Error: ${(e as Error).message}`, fired: false, deliveryStatus: 'failed', deliveryError: (e as Error).message })
      }
    }

    return apiSuccess({ evaluated: dbAlerts.length, triggered, results });
  } catch (error) {
    console.error("GET /api/v1/alerts/evaluate error:", error);
    return apiError("Internal server error", 500);
  }
}

async function fetchEventForAlert(
  type: string,
  config: Record<string, unknown>,
  calendarEvents: Array<{ date: string; event: string; country: string }>,
  today: string,
): Promise<NexusEvent | null> {
  const timestamp = new Date().toISOString();
  const registry = registerAllModules();

  switch (type) {
    case "price_threshold": {
      const symbol = String(config.symbol ?? "");
      if (!symbol) return null;
      const result = await registry.fetchOne("yahoo-finance", { symbols: symbol, action: "quote" });
      const data = ((result?.data as Array<Record<string, unknown>> | null) ?? [])[0];
      const price = (data?.price as number | undefined) ?? (data?.regularMarketPrice as number | undefined);
      if (price == null) return null;
      return { type: "price_threshold", symbol, price, timestamp };
    }

    case "forex_rate": {
      const pair = String(config.pair ?? "");
      if (!pair.includes("/")) return null;
      const [base, quote] = pair.split("/").map((s) => s.toUpperCase());
      const result = await registry.fetchOne("exchangerate-api", { base: "USD" });
      const rates = ((result?.data as { rates?: Record<string, number> } | null)?.rates) ?? {};

      let rate: number | null = null;
      if (base === "USD" && rates[quote] != null) rate = rates[quote];
      else if (quote === "USD" && rates[base] != null) rate = 1 / rates[base];
      else if (rates[base] != null && rates[quote] != null) rate = rates[quote] / rates[base];

      if (rate == null || !Number.isFinite(rate)) return null;
      return { type: "forex_rate", pair, rate, timestamp };
    }

    case "macro_event": {
      const eventName = String(config.event ?? "");
      const country = String(config.country ?? "US");
      const match = calendarEvents.find((e) => e.date === today && e.event === eventName && (!country || e.country === country));
      if (!match) return null;
      return { type: "macro_event", event: match.event, country: match.country, timestamp };
    }

    case "wallet_moved":
    case "smart_money_action":
    case "prediction_threshold":
      return null;

    default:
      return null;
  }
}

function buildTriggerMessage(type: string, config: Record<string, unknown>, event: NexusEvent): string {
  switch (type) {
    case "price_threshold": {
      const e = event as { price: number };
      return `${config.symbol} at $${e.price.toFixed(2)} — ${config.direction} $${config.threshold}`
    }
    case "forex_rate": {
      const e = event as { rate: number };
      return `${config.pair} at ${e.rate.toFixed(4)} — ${config.direction} ${config.threshold}`
    }
    case "macro_event":
      return `Macro event: ${config.event}${config.country ? ` (${config.country})` : ""}`
    default:
      return `Alert triggered: ${type}`
  }
}
