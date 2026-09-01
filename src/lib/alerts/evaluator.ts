import { AlertCondition, type WalletMovedCondition, type SmartMoneyCondition, type PredictionThresholdCondition, type PriceThresholdCondition, type ForexRateCondition, type ConvictionThresholdCondition } from "./schemas";

export interface TradeEvent {
  type: "trade";
  marketId: string;
  marketTitle: string;
  direction: string;
  shares: number;
  price: number;
  value: number;
  wallet: string;
  timestamp: string;
}

interface WalletEvent {
  type: "wallet_moved";
  address: string;
  amountUsd: number;
  chain: string;
  txHash: string;
  timestamp: string;
}

interface SmartMoneyEvent {
  type: "smart_money_action";
  action: "Accumulated" | "Exited" | "Bridged" | "Swapped";
  wallet: string;
  token?: string;
  amountUsd?: number;
  score?: number;
  timestamp: string;
}

interface PredictionEvent {
  type: "prediction_threshold";
  marketId: string;
  marketTitle: string;
  currentPrice: number;
  timestamp: string;
}

interface ConvictionEvent {
  type: "conviction_threshold";
  symbol: string;
  conviction: number;
  action: 'BUY' | 'WAIT' | 'SELL';
  direction: 'bull' | 'bear' | 'neutral';
  timestamp: string;
}

// ─── TradFi event types ───────────────────────────────────

interface PriceEvent {
  type: "price_threshold";
  symbol: string;
  price: number;
  timestamp: string;
}

interface MacroEvent {
  type: "macro_event";
  event: string;
  country: string;
  value?: string;
  timestamp: string;
}

interface ForexEvent {
  type: "forex_rate";
  pair: string;
  rate: number;
  timestamp: string;
}

export type NexusEvent = TradeEvent | WalletEvent | SmartMoneyEvent | PredictionEvent | PriceEvent | MacroEvent | ForexEvent | ConvictionEvent;

export function evaluateCondition(
  condition: AlertCondition,
  event: NexusEvent,
): boolean {
  switch (condition.type) {
    case "wallet_moved":
      return evaluateWalletMoved(condition, event);
    case "smart_money_action":
      return evaluateSmartMoney(condition, event);
    case "prediction_threshold":
      return evaluatePredictionThreshold(condition, event);
    case "price_threshold":
      return evaluatePriceThreshold(condition, event);
    case "macro_event":
      return evaluateMacroEvent(condition, event);
    case "forex_rate":
      return evaluateForexRate(condition, event);
    case "conviction_threshold":
      return evaluateConvictionThreshold(condition, event);
    default:
      return false;
  }
}

function evaluateWalletMoved(
  condition: WalletMovedCondition,
  event: NexusEvent,
): boolean {
  if (event.type !== "wallet_moved") return false;
  return (
    event.address.toLowerCase() === condition.address.toLowerCase() &&
    event.amountUsd >= condition.minAmountUsd
  );
}

function evaluateSmartMoney(
  condition: SmartMoneyCondition,
  event: NexusEvent,
): boolean {
  if (event.type !== "smart_money_action") return false;
  if (event.action !== condition.action) return false;
  if (condition.minScore !== undefined && (event.score ?? 0) < condition.minScore) {
    return false;
  }
  return true;
}

function evaluatePredictionThreshold(
  condition: PredictionThresholdCondition,
  event: NexusEvent,
): boolean {
  if (event.type !== "prediction_threshold") return false;
  if (event.marketId !== condition.marketId) return false;
  if (condition.direction === "above") {
    return event.currentPrice >= condition.threshold;
  }
  return event.currentPrice <= condition.threshold;
}

function evaluatePriceThreshold(
  condition: PriceThresholdCondition,
  event: NexusEvent,
): boolean {
  if (event.type !== "price_threshold") return false;
  if (event.symbol !== condition.symbol) return false;
  if (condition.direction === "above") {
    return event.price >= condition.threshold;
  }
  return event.price <= condition.threshold;
}

function evaluateMacroEvent(
  condition: AlertCondition & { type: "macro_event" },
  event: NexusEvent,
): boolean {
  if (event.type !== "macro_event") return false;
  if (event.event !== condition.event) return false;
  if (condition.country && event.type === "macro_event" && event.country !== condition.country) return false;
  return true;
}

function evaluateForexRate(
  condition: ForexRateCondition,
  event: NexusEvent,
): boolean {
  if (event.type !== "forex_rate") return false;
  if (event.pair !== condition.pair) return false;
  if (condition.direction === "above") {
    return event.rate >= condition.threshold;
  }
  return event.rate <= condition.threshold;
}

function evaluateConvictionThreshold(
  condition: ConvictionThresholdCondition,
  event: NexusEvent,
): boolean {
  if (event.type !== "conviction_threshold") return false;
  if (event.symbol !== condition.symbol) return false;
  if (condition.direction === "above") {
    return event.conviction >= condition.threshold;
  }
  return event.conviction <= condition.threshold;
}
