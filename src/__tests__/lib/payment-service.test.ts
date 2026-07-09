// Mock environment variables
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentService, getPaymentService } from '@/lib/payment-service';
import type { Order } from '@1ai/payment';

 // Mock the SDK
 const mockCreate = vi.fn();
 const mockGet = vi.fn();
 const mockListGateways = vi.fn();
 
 vi.mock('@1ai/payment', () => {
   return {
     OneAIPayment: vi.fn().mockImplementation(() => {
       return {
         create: mockCreate,
         get: mockGet,
         listGateways: mockListGateways,
       };
     }),
   };
 });
 
 describe('PaymentService', () => {
   let service: PaymentService;
 
   beforeEach(() => {
     vi.clearAllMocks();
     service = new PaymentService({
       apiKey: 'test-api-key',
       baseUrl: 'http://localhost:3100',
     });
   });

  describe('constructor', () => {
    it('should throw error when API key is missing', () => {
      expect(() => new PaymentService({ apiKey: '' })).toThrow(
        'Payment service API key is required'
      );
    });

    it('should initialize with valid config', () => {
      expect(service).toBeInstanceOf(PaymentService);
    });
  });

  describe('createSubscriptionPayment', () => {
   it('should create payment order for pro plan', async () => {
    const mockOrder: Order = {
      id: 'ord_123',
      amount: 50000,
      currency: 'IDR',
      status: 'pending',
      gateway: 'midtrans',
      gateway_reference: 'midtrans_ref_123',
      payment_method: 'credit_card',
      payment_url: 'https://payment.example.com/ord_123',
      metadata: {
        userId: 'user_123',
        plan: 'pro',
        type: 'subscription',
      },
      created_at: '2026-07-09T12:00:00.000Z',
      updated_at: '2026-07-09T12:00:00.000Z',
    };
 
     mockCreate.mockResolvedValue(mockOrder);
 
     const result = await service.createSubscriptionPayment({
       userId: 'user_123',
       plan: 'pro',
       amount: 50000,
       currency: 'IDR',
       gateway: 'midtrans',
       customerEmail: 'test@example.com',
       customerName: 'Test User',
      callbackUrl: 'http://localhost:3000/api/v1/webhooks/payment',
     });
 
     expect(mockCreate).toHaveBeenCalledWith({
       amount: 50000,
       currency: 'IDR',
       gateway: 'midtrans',
       customer: {
         email: 'test@example.com',
         name: 'Test User',
       },
       items: [
         {
           name: 'PRO Plan Subscription',
           quantity: 1,
           price: 50000,
         },
       ],
       metadata: {
         userId: 'user_123',
         plan: 'pro',
         type: 'subscription',
       },
      callback_url: 'http://localhost:3000/api/v1/webhooks/payment',
     });
 
     expect(result).toEqual({
       orderId: 'ord_123',
       status: 'pending',
       amount: 50000,
       currency: 'IDR',
       gateway: 'midtrans',
       paymentUrl: 'https://payment.example.com/ord_123',
      expiresAt: new Date('2026-07-10T12:00:00.000Z'),
       metadata: {
         userId: 'user_123',
         plan: 'pro',
         type: 'subscription',
       },
     });
   });

   it('should create payment order for enterprise plan without customer name', async () => {
    const mockOrder: Order = {
      id: 'ord_456',
      amount: 150000,
      currency: 'IDR',
      status: 'pending',
      gateway: 'tripay',
      gateway_reference: 'tripay_ref_456',
      payment_method: 'bank_transfer',
      payment_url: 'https://payment.example.com/ord_456',
      metadata: {
        userId: 'user_456',
        plan: 'enterprise',
        type: 'subscription',
      },
      created_at: '2026-07-09T10:00:00.000Z',
      updated_at: '2026-07-09T11:30:00.000Z',
    };
 
     mockCreate.mockResolvedValue(mockOrder);
 
     const result = await service.createSubscriptionPayment({
       userId: 'user_456',
       plan: 'enterprise',
       amount: 150000,
       currency: 'IDR',
       gateway: 'duitku',
       customerEmail: 'enterprise@example.com',
      callbackUrl: 'http://localhost:3000/api/v1/webhooks/payment',
     });
 
     expect(mockCreate).toHaveBeenCalledWith({
       amount: 150000,
       currency: 'IDR',
       gateway: 'duitku',
       customer: {
         email: 'enterprise@example.com',
       },
       items: [
         {
           name: 'ENTERPRISE Plan Subscription',
           quantity: 1,
           price: 150000,
         },
       ],
       metadata: {
         userId: 'user_456',
         plan: 'enterprise',
         type: 'subscription',
       },
      callback_url: 'http://localhost:3000/api/v1/webhooks/payment',
     });
 
     expect(result.orderId).toBe('ord_456');
     expect(result.status).toBe('pending');
   });
  });

  describe('getPaymentStatus', () => {
    it('should get payment status for pending order', async () => {
      const mockOrder: Order = {
        id: 'ord_789',
        amount: 50000,
        currency: 'IDR',
        status: 'pending',
        gateway: 'midtrans',
        paymentUrl: 'https://payment.example.com/ord_789',
        expiresAt: '2026-07-10T08:52:28.397Z',
        metadata: {
          userId: 'user_789',
          plan: 'pro',
          type: 'subscription',
        },
      };

     mockGet.mockResolvedValue(mockOrder);
 
     const result = await service.getPaymentStatus('ord_789');
 
     expect(mockGet).toHaveBeenCalledWith('ord_789');
      expect(result.orderId).toBe('ord_789');
      expect(result.status).toBe('pending');
      expect(result.paidAt).toBeUndefined();
    });

    it('should get payment status for paid order', async () => {
      const mockOrder: Order = {
        id: 'ord_paid',
        amount: 50000,
        currency: 'IDR',
        status: 'paid',
        gateway: 'midtrans',
        paidAt: '2026-07-09T08:00:00.000Z',
        metadata: {
          userId: 'user_paid',
          plan: 'pro',
          type: 'subscription',
        },
      };

     mockGet.mockResolvedValue(mockOrder);

      const result = await service.getPaymentStatus('ord_paid');

      expect(result.status).toBe('paid');
      expect(result.paidAt).toEqual(new Date('2026-07-09T08:00:00.000Z'));
    });

    it('should get payment status for failed order', async () => {
      const mockOrder: Order = {
        id: 'ord_failed',
        amount: 50000,
        currency: 'IDR',
        status: 'failed',
        gateway: 'midtrans',
        metadata: {
          userId: 'user_failed',
          plan: 'pro',
          type: 'subscription',
        },
      };

     mockGet.mockResolvedValue(mockOrder);

      const result = await service.getPaymentStatus('ord_failed');

      expect(result.status).toBe('failed');
    });

    it('should get payment status for expired order', async () => {
      const mockOrder: Order = {
        id: 'ord_expired',
        amount: 50000,
        currency: 'IDR',
        status: 'expired',
        gateway: 'midtrans',
        expiresAt: '2026-07-08T08:52:28.397Z',
        metadata: {
          userId: 'user_expired',
          plan: 'pro',
          type: 'subscription',
        },
      };

      mockGet.mockResolvedValue(mockOrder);

      const result = await service.getPaymentStatus('ord_expired');

      expect(result.status).toBe('expired');
      expect(result.expiresAt).toEqual(new Date('2026-07-08T08:52:28.397Z'));
    });
  });

  describe('listGateways', () => {
    it('should list available payment gateways', async () => {
      const mockGateways = [
        {
          id: 'midtrans',
          name: 'Midtrans',
          configured: true,
          supportedCurrencies: ['IDR'],
        },
        {
          id: 'duitku',
          name: 'Duitku',
          configured: true,
          supportedCurrencies: ['IDR'],
        },
      ];

      mockListGateways.mockResolvedValue(mockGateways);

      const result = await service.listGateways();

      expect(mockListGateways).toHaveBeenCalled();
      expect(result).toEqual(mockGateways);
      expect(result).toHaveLength(2);
    });
  });
});

describe('getPaymentService', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('should throw error when ONEAI_PAYMENT_API_KEY is missing', () => {
    delete process.env.ONEAI_PAYMENT_API_KEY;
    
    expect(() => getPaymentService()).toThrow(
      'ONEAI_PAYMENT_API_KEY environment variable is required'
    );
  });

  it('should create singleton instance with env vars', () => {
    process.env.ONEAI_PAYMENT_API_KEY = 'test-key';
    process.env.ONEAI_PAYMENT_BASE_URL = 'http://localhost:3100';

    const service1 = getPaymentService();
    const service2 = getPaymentService();

    expect(service1).toBe(service2); // Same instance
    expect(service1).toBeInstanceOf(PaymentService);
  });
});
