// Type declarations for the (proprietary) @1ai/payment SDK shim.
// Mirrors the surface consumed by src/lib/payment-service.ts.

export interface Order {
  id: string;
  status: string;
  amount: number;
  currency: string;
  gateway: string;
  payment_url?: string | null;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
  paidAt?: string;
}

export interface GatewayInfo {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface OneAIPaymentOptions {
  apiKey: string;
  baseUrl?: string;
}

export class OneAIPayment {
  constructor(options: OneAIPaymentOptions);
  create(params: Record<string, unknown>): Promise<Order>;
  get(orderId: string): Promise<Order>;
  listGateways(): Promise<GatewayInfo[]>;
}
