// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used in typeof for ChannelName
const REDIS_CHANNELS = {
  TRADES: "nexus:trades",
  ALERTS: "nexus:alerts",
  PRICES: "nexus:prices",
  FLOWS: "nexus:flows",
} as const;

export type ChannelName = (typeof REDIS_CHANNELS)[keyof typeof REDIS_CHANNELS];

export interface NexusEvent<T = unknown> {
  type: string;
  channel: ChannelName;
  data: T;
  timestamp: number;
  source?: string;
}

export interface TradeEvent {
  marketId: string;
  marketTitle: string;
  platform: "polymarket" | "kalshi" | "other";
  side: "buy" | "sell";
  outcome: string;
  price: number;
  amount: number;
  walletAddress?: string;
  timestamp: number;
}

export interface AlertEvent {
  alertId: string;
  triggerType: string;
  conditions: Record<string, unknown>;
  message: string;
  walletAddress?: string;
  entityId?: string;
  timestamp: number;
}

interface _PriceEvent {
  marketId: string;
  platform: string;
  outcome: string;
  price: number;
  previousPrice?: number;
  timestamp: number;
}

export interface FlowEvent {
  entityId: string;
  entityName: string;
  flowType: string;
  amountUsd: number;
  chain?: string;
  txHash?: string;
  timestamp: number;
}
