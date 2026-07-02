// ─────────────────────────────────────────────────────────────
// Payment Gateway Router
// Routes to the correct provider based on user selection
// ─────────────────────────────────────────────────────────────

import type { PaymentProvider, PaymentRequest, PaymentResponse, WebhookPayload } from './types'
import { TripayProvider } from './tripay'
import { MidtransProvider } from './midtrans'
import { DuitkuProvider } from './duitku'
import { NowPaymentsProvider } from './nowpayments'

export type PaymentMethod = 'tripay' | 'midtrans' | 'duitku' | 'nowpayments'

const providers: Record<PaymentMethod, PaymentProvider> = {
  tripay: new TripayProvider(),
  midtrans: new MidtransProvider(),
  duitku: new DuitkuProvider(),
  nowpayments: new NowPaymentsProvider(),
}

export function getProvider(method: PaymentMethod): PaymentProvider {
  return providers[method]
}

export function getAvailableMethods(): Array<{ id: PaymentMethod; name: string; description: string }> {
  return [
    {
      id: 'tripay',
      name: 'Tripay',
      description: 'QRIS, Virtual Account (BCA, BNI, BRI, Mandiri), Alfamart',
    },
    {
      id: 'midtrans',
      name: 'Midtrans',
      description: 'Credit Card, QRIS, Gopay, OVO, Dana, VA',
    },
    {
      id: 'duitku',
      name: 'Duitku',
      description: 'Virtual Account, Alfamart, Indomaret',
    },
    {
      id: 'nowpayments',
      name: 'Crypto (NOWPayments)',
      description: 'BTC, ETH, USDT, USDC, SOL, and 100+ cryptocurrencies',
    },
  ]
}

export async function createPayment(
  method: PaymentMethod,
  req: PaymentRequest
): Promise<PaymentResponse> {
  const provider = getProvider(method)
  return provider.createPayment(req)
}

export function verifyWebhook(
  method: PaymentMethod,
  headers: Record<string, string>,
  body: string
): WebhookPayload | null {
  const provider = getProvider(method)
  return provider.verifyWebhook(headers, body)
}
