import { OneAIPayment } from '@1ai/payment';
import type { Order, GatewayInfo } from '@1ai/payment';

// Plan-based subscription payment parameters
export interface CreatePaymentParams {
  userId: string;
  plan: string;
  amount: number;
  currency: string;
  gateway: string;
  customerEmail: string;
  customerName?: string;
  returnUrl: string;
  cancelUrl: string;
}

interface PaymentOrder {
  orderId: string;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  amount: number;
  currency: string;
  gateway: string;
  paymentUrl?: string;
  expiresAt?: Date;
  paidAt?: Date;
  metadata?: Record<string, any>;
}

export class PaymentService {
  private client: OneAIPayment;

  constructor({ apiKey, baseUrl }: { apiKey: string; baseUrl?: string }) {
    if (!apiKey || apiKey === '') {
      throw new Error('Payment service API key is required');
    }
    this.client = new OneAIPayment({ apiKey, baseUrl: baseUrl || 'http://localhost:3100' });
  }

  async createSubscriptionPayment(params: CreatePaymentParams): Promise<PaymentOrder> {
    // Transform plan-based params to SDK format
    const sdkParams = {
      amount: params.amount,
      currency: params.currency,
      gateway: params.gateway,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/v1/webhooks/payment`,
      customer: {
        email: params.customerEmail,
        name: params.customerName,
      },
      items: [
        {
          name: `${params.plan.toUpperCase()} Plan Subscription`,
          quantity: 1,
          price: params.amount,
        },
      ],
      metadata: {
        userId: params.userId,
        plan: params.plan,
        type: 'subscription',
      },
    };

    const order = await this.client.create(sdkParams);
    return this.normalizeOrder(order);
  }

  async getPaymentStatus(orderId: string): Promise<PaymentOrder> {
    const order = await this.client.get(orderId);
    return this.normalizeOrder(order);
  }

  async listGateways(): Promise<GatewayInfo[]> {
    return this.client.listGateways();
  }

  private normalizeOrder(order: Order): PaymentOrder {
    return {
      orderId: order.id,
      status: order.status as 'pending' | 'paid' | 'failed' | 'expired',
      amount: order.amount,
      currency: order.currency,
      gateway: order.gateway,
      paymentUrl: order.payment_url ?? undefined,
      expiresAt: (order as any).expiresAt
        ? new Date((order as any).expiresAt)
        : order.status === 'pending'
          ? new Date(new Date(order.created_at).getTime() + 24 * 60 * 60 * 1000)
          : undefined,
      paidAt: (order as any).paidAt
        ? new Date((order as any).paidAt)
        : order.status === 'paid'
          ? new Date(order.updated_at)
          : undefined,
      metadata: order.metadata ?? {},
    };
  }
}

let paymentServiceInstance: PaymentService | null = null;

export function getPaymentService(): PaymentService {
  if (!paymentServiceInstance) {
    const apiKey = process.env.ONEAI_PAYMENT_API_KEY;
    const baseUrl = process.env.ONEAI_PAYMENT_BASE_URL;

    if (!apiKey) {
      throw new Error(
        'ONEAI_PAYMENT_API_KEY environment variable is required'
      );
    }

    paymentServiceInstance = new PaymentService({ apiKey, baseUrl });
  }

  return paymentServiceInstance;
}
