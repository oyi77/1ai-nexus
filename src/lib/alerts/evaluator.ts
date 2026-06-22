import { AlertCondition, type WalletMovedCondition, type SmartMoneyCondition, type PredictionThresholdCondition } from "./schemas";

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

export type NexusEvent = TradeEvent | WalletEvent | SmartMoneyEvent | PredictionEvent;

export function evaluateCondition(
  condition: AlertCondition,
  event: NexusEvent
): boolean {
  switch (condition.type) {
    case "wallet_moved":
      return evaluateWalletMoved(condition, event);
    case "smart_money_action":
      return evaluateSmartMoney(condition, event);
    case "prediction_threshold":
      return evaluatePredictionThreshold(condition, event);
    default:
      return false;
  }
}

function evaluateWalletMoved(
  condition: WalletMovedCondition,
  event: NexusEvent
): boolean {
  if (event.type !== "wallet_moved") return false;
  return (
    event.address.toLowerCase() === condition.address.toLowerCase() &&
    event.amountUsd >= condition.minAmountUsd
  );
}

function evaluateSmartMoney(
  condition: SmartMoneyCondition,
  event: NexusEvent
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
  event: NexusEvent
): boolean {
  if (event.type !== "prediction_threshold") return false;
  if (event.marketId !== condition.marketId) return false;
  if (condition.direction === "above") {
    return event.currentPrice >= condition.threshold;
  }
  return event.currentPrice <= condition.threshold;
}
