// ─────────────────────────────────────────────────────────────
// Payment Gateway Provider Interface
// Supports: Tripay, Midtrans, Duitku, NOWPayments
// ─────────────────────────────────────────────────────────────

export interface PaymentRequest {
  orderId: string
  amount: number
  currency: string
  description: string
  customerEmail: string
  customerName?: string
  callbackUrl?: string
  redirectUrl?: string
}

export interface PaymentResponse {
  success: boolean
  paymentUrl?: string
  paymentId?: string
  qrCode?: string
  virtualAccount?: string
  error?: string
}

export interface WebhookPayload {
  orderId: string
  status: 'pending' | 'success' | 'failed' | 'expired'
  amount: number
  currency: string
  timestamp: number
  raw: Record<string, unknown>
}

export interface PaymentProvider {
  name: string
  createPayment(req: PaymentRequest): Promise<PaymentResponse>
  verifyWebhook(headers: Record<string, string>, body: string): WebhookPayload | null
  checkStatus(paymentId: string): Promise<{ status: string; paid: boolean }>
}
