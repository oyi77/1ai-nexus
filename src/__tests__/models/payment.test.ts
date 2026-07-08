import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { PrismaClient, SubscriptionPlan, SubscriptionStatus, PaymentStatus } from '@prisma/client';

const prisma = new PrismaClient();

describe('Payment Model', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data before each test to ensure isolation
    await prisma.payment.deleteMany({ where: { subscription: { user: { email: { startsWith: 'test-payment-' } } } } });
    await prisma.subscription.deleteMany({ where: { user: { email: { startsWith: 'test-payment-' } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'test-payment-' } } });
  });

  describe('Payment Creation', () => {
    it('should create payment with required fields', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-user@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const payment = await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: 29.0,
          currency: 'USD',
          status: PaymentStatus.completed,
          provider: 'stripe',
          externalId: 'pi_test123',
        },
      });

      expect(payment.subscriptionId).toBe(subscription.id);
      expect(payment.amount).toBe(29.0);
      expect(payment.currency).toBe('USD');
      expect(payment.status).toBe(PaymentStatus.completed);
      expect(payment.provider).toBe('stripe');
      expect(payment.externalId).toBe('pi_test123');
      expect(payment.metadata).toBeNull();
    });

    it('should create payment with metadata', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-metadata@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const metadata = {
        paymentMethod: 'credit_card',
        cardBrand: 'visa',
        last4: '4242',
        invoiceId: 'inv_123',
      };

      const payment = await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: 99.0,
          currency: 'USD',
          status: PaymentStatus.completed,
          provider: 'stripe',
          externalId: 'pi_metadata123',
          metadata,
        },
      });

      expect(payment.metadata).toEqual(metadata);
    });
  });

  describe('Payment-Subscription Relations', () => {
    it('should fetch payment with subscription data', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-relation@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const created = await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: 29.0,
          currency: 'USD',
          status: PaymentStatus.completed,
          provider: 'stripe',
          externalId: 'pi_relation123',
        },
      });

      const fetched = await prisma.payment.findUnique({
        where: { id: created.id },
        include: { subscription: true },
      });

      expect(fetched).not.toBeNull();
      expect(fetched?.subscription.id).toBe(subscription.id);
      expect(fetched?.subscription.userId).toBe(user.id);
    });

    it('should fetch subscription with multiple payments', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-multiple@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      await prisma.payment.createMany({
        data: [
          {
            subscriptionId: subscription.id,
            amount: 29.0,
            currency: 'USD',
            status: PaymentStatus.completed,
            provider: 'stripe',
            externalId: 'pi_first123',
          },
          {
            subscriptionId: subscription.id,
            amount: 29.0,
            currency: 'USD',
            status: PaymentStatus.completed,
            provider: 'stripe',
            externalId: 'pi_second123',
          },
        ],
      });

      const subWithPayments = await prisma.subscription.findUnique({
        where: { id: subscription.id },
        include: {
          payments: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      // Verify both payments exist (order doesn't matter for this test)
      expect(subWithPayments?.payments).toHaveLength(2);
      const externalIds = subWithPayments?.payments.map(p => p.externalId) ?? [];
      expect(externalIds).toContain('pi_first123');
      expect(externalIds).toContain('pi_second123');
    });
  });

  describe('Payment Status Transitions', () => {
    it('should update payment status', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-status@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const payment = await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: 29.0,
          currency: 'USD',
          status: PaymentStatus.pending,
          provider: 'stripe',
          externalId: 'pi_status123',
        },
      });

      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.completed },
      });

      expect(updated.status).toBe(PaymentStatus.completed);
    });

    it('should handle all status enum values', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-enums@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const statuses = [
        PaymentStatus.pending,
        PaymentStatus.completed,
        PaymentStatus.failed,
        PaymentStatus.refunded,
      ];

      for (const status of statuses) {
        const payment = await prisma.payment.create({
          data: {
            subscriptionId: subscription.id,
            amount: 29.0,
            currency: 'USD',
            status,
            provider: 'stripe',
            externalId: `pi_${status}_123`,
          },
        });

        expect(payment.status).toBe(status);
      }
    });
  });

  describe('Payment Provider Validation', () => {
    it('should accept different payment providers', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-providers@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const providers = ['stripe', 'tripay', 'midtrans', 'duitku', 'nowpayments'];

      for (const provider of providers) {
        const payment = await prisma.payment.create({
          data: {
            subscriptionId: subscription.id,
            amount: 99.0,
            currency: provider === 'stripe' ? 'USD' : 'IDR',
            status: PaymentStatus.completed,
            provider,
            externalId: `${provider}_test123`,
          },
        });

        expect(payment.provider).toBe(provider);
      }
    });
  });

  describe('Payment Currency Handling', () => {
    it('should handle different currencies', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-currency@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const currencies = [
        { currency: 'USD', amount: 29.0 },
        { currency: 'IDR', amount: 449500.0 },
        { currency: 'BTC', amount: 0.00045 },
      ];

      for (const { currency, amount } of currencies) {
        const payment = await prisma.payment.create({
          data: {
            subscriptionId: subscription.id,
            amount,
            currency,
            status: PaymentStatus.completed,
            provider: 'test-provider',
            externalId: `${currency}_test123`,
          },
        });

        expect(payment.currency).toBe(currency);
        expect(payment.amount).toBe(amount);
      }
    });
  });

  describe('Payment ExternalId Uniqueness', () => {
    it('should allow same externalId for different providers', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-external@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const externalId = 'duplicate_id_123';

      const payment1 = await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: 29.0,
          currency: 'USD',
          status: PaymentStatus.completed,
          provider: 'stripe',
          externalId,
        },
      });

      const payment2 = await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: 449500.0,
          currency: 'IDR',
          status: PaymentStatus.completed,
          provider: 'tripay',
          externalId,
        },
      });

      expect(payment1.externalId).toBe(externalId);
      expect(payment2.externalId).toBe(externalId);
      expect(payment1.provider).not.toBe(payment2.provider);
    });
  });

  describe('Payment Queries', () => {
    it('should find completed payments', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-query@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      await prisma.payment.createMany({
        data: [
          {
            subscriptionId: subscription.id,
            amount: 29.0,
            currency: 'USD',
            status: PaymentStatus.completed,
            provider: 'stripe',
            externalId: 'pi_completed1',
          },
          {
            subscriptionId: subscription.id,
            amount: 29.0,
            currency: 'USD',
            status: PaymentStatus.failed,
            provider: 'stripe',
            externalId: 'pi_failed1',
          },
          {
            subscriptionId: subscription.id,
            amount: 29.0,
            currency: 'USD',
            status: PaymentStatus.completed,
            provider: 'stripe',
            externalId: 'pi_completed2',
          },
        ],
      });

      const completedPayments = await prisma.payment.findMany({
        where: {
          subscription: {
            userId: user.id,
          },
          status: PaymentStatus.completed,
        },
      });

      expect(completedPayments).toHaveLength(2);
      completedPayments.forEach((payment) => {
        expect(payment.status).toBe(PaymentStatus.completed);
      });
    });

    it('should find payments by provider', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-provider-query@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      await prisma.payment.createMany({
        data: [
          {
            subscriptionId: subscription.id,
            amount: 29.0,
            currency: 'USD',
            status: PaymentStatus.completed,
            provider: 'stripe',
            externalId: 'stripe_1',
          },
          {
            subscriptionId: subscription.id,
            amount: 449500.0,
            currency: 'IDR',
            status: PaymentStatus.completed,
            provider: 'tripay',
            externalId: 'tripay_1',
          },
          {
            subscriptionId: subscription.id,
            amount: 29.0,
            currency: 'USD',
            status: PaymentStatus.completed,
            provider: 'stripe',
            externalId: 'stripe_2',
          },
        ],
      });

      const stripePayments = await prisma.payment.findMany({
        where: {
          subscription: {
            userId: user.id,
          },
          provider: 'stripe',
        },
      });

      expect(stripePayments).toHaveLength(2);
      stripePayments.forEach((payment) => {
        expect(payment.provider).toBe('stripe');
      });
    });

    it('should find payments by externalId and provider', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-external-query@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const externalId = 'unique_payment_123';
      const provider = 'stripe';

      await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: 29.0,
          currency: 'USD',
          status: PaymentStatus.completed,
          provider,
          externalId,
        },
      });

      const payment = await prisma.payment.findFirst({
        where: {
          provider,
          externalId,
        },
      });

      expect(payment).not.toBeNull();
      expect(payment?.provider).toBe(provider);
      expect(payment?.externalId).toBe(externalId);
    });
  });

  describe('Payment Metadata Operations', () => {
    it('should update payment metadata', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-payment-metadata-update@example.com',
          passwordHash: 'test-hash',
        },
      });

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: now,
          endDate: futureDate,
        },
      });

      const payment = await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: 29.0,
          currency: 'USD',
          status: PaymentStatus.pending,
          provider: 'stripe',
          externalId: 'pi_metadata_update',
        },
      });

      const newMetadata = {
        webhookReceived: true,
        webhookTimestamp: new Date().toISOString(),
        paymentIntent: 'pi_metadata_update',
      };

      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.completed,
          metadata: newMetadata,
        },
      });

      expect(updated.metadata).toEqual(newMetadata);
      expect(updated.status).toBe(PaymentStatus.completed);
    });
  });
});
