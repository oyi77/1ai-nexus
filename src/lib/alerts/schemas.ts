import { z } from "zod";

export const WalletMovedCondition = z.object({
  type: z.literal("wallet_moved"),
  address: z.string(),
  minAmountUsd: z.number(),
});

export const SmartMoneyCondition = z.object({
  type: z.literal("smart_money_action"),
  action: z.enum(["Accumulated", "Exited", "Bridged", "Swapped"]),
  minScore: z.number().optional(),
});

export const PredictionThresholdCondition = z.object({
  type: z.literal("prediction_threshold"),
  marketId: z.string(),
  threshold: z.number(),
  direction: z.enum(["above", "below"]),
});

// ─── TradFi alert conditions ──────────────────────────────

export const PriceThresholdCondition = z.object({
  type: z.literal("price_threshold"),
  symbol: z.string(), // e.g. 'AAPL', 'EUR/USD', 'GC=F', '^GSPC'
  threshold: z.number(),
  direction: z.enum(["above", "below"]),
});

export const MacroEventCondition = z.object({
  type: z.literal("macro_event"),
  event: z.string(), // e.g. 'FOMC Rate Decision', 'CPI (YoY)', 'Non-Farm Payrolls'
  country: z.string().optional(), // e.g. 'US', 'ID', 'EU'

});

export const ForexRateCondition = z.object({
  type: z.literal("forex_rate"),
  pair: z.string(), // e.g. 'USD/IDR', 'EUR/USD'
  threshold: z.number(),
  direction: z.enum(["above", "below"]),
});

export const ConvictionThresholdCondition = z.object({
  type: z.literal("conviction_threshold"),
  symbol: z.string(), // e.g. 'BTC', 'ETH', 'LEAD'
  threshold: z.number().min(0).max(100), // conviction score 0-100
  direction: z.enum(["above", "below"]),
});

export const AlertCondition = z.discriminatedUnion("type", [
  WalletMovedCondition,
  SmartMoneyCondition,
  PredictionThresholdCondition,
  PriceThresholdCondition,
  MacroEventCondition,
  ForexRateCondition,
  ConvictionThresholdCondition,
]);

export type ConvictionThresholdCondition = z.infer<typeof ConvictionThresholdCondition>;

export type WalletMovedCondition = z.infer<typeof WalletMovedCondition>;
export type SmartMoneyCondition = z.infer<typeof SmartMoneyCondition>;
export type PredictionThresholdCondition = z.infer<typeof PredictionThresholdCondition>;
export type PriceThresholdCondition = z.infer<typeof PriceThresholdCondition>;
export type MacroEventCondition = z.infer<typeof MacroEventCondition>;
export type ForexRateCondition = z.infer<typeof ForexRateCondition>;
export type AlertCondition = z.infer<typeof AlertCondition>;
