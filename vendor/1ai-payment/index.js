'use strict';

// Local shim for the proprietary @1ai/payment SDK.
// Implements the minimal contract consumed by src/lib/payment-service.ts:
//   new OneAIPayment({ apiKey, baseUrl? })
//   .create(params) -> Order
//   .get(orderId)   -> Order
//   .listGateways() -> GatewayInfo[]
// Payment calls are no-ops (returns pending stubs); wire to a real
// gateway only when the genuine @1ai/payment package is available.

class OneAIPayment {
  constructor(options) {
    const opts = options || {};
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl || 'http://localhost:3100';
  }

  async create(params) {
    const now = new Date().toISOString();
    return {
      id: 'shim_' + Date.now(),
      status: 'pending',
      amount: params && typeof params.amount === 'number' ? params.amount : 0,
      currency: (params && params.currency) || 'USD',
      gateway: (params && params.gateway) || 'shim',
      payment_url: null,
      created_at: now,
      updated_at: now,
      metadata: (params && params.metadata) || {},
    };
  }

  async get(orderId) {
    const now = new Date().toISOString();
    return {
      id: orderId,
      status: 'pending',
      amount: 0,
      currency: 'USD',
      gateway: 'shim',
      payment_url: null,
      created_at: now,
      updated_at: now,
      metadata: {},
    };
  }

  async listGateways() {
    return [];
  }
}

module.exports = { OneAIPayment };
