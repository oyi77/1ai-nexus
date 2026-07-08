import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

  beforeEach(async () => {
    // Clean up test data before each test to ensure isolation
    await prisma.payment.deleteMany({ where: { subscription: { user: { email: { startsWith: 'test-sub-' } } } } });
    await prisma.subscription.deleteMany({ where: { user: { email: { startsWith: 'test-sub-' } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'test-sub-' } } });
  });

describe('Subscription Model', () => {
  describe('Subscription Creation', () => {
    it('should create subscription with required fields', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-user@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      expect(subscription.id).toBeDefined();
      expect(subscription.userId).toBe(user.id);
      expect(subscription.plan).toBe(SubscriptionPlan.pro);
      expect(subscription.status).toBe(SubscriptionStatus.active);
      expect(subscription.startDate).toEqual(new Date('2026-07-01'));
      expect(subscription.endDate).toEqual(new Date('2026-08-01'));
      expect(subscription.canceledAt).toBeNull();
      expect(subscription.createdAt).toBeInstanceOf(Date);
      expect(subscription.updatedAt).toBeInstanceOf(Date);
    });

    it('should create subscription with optional canceledAt', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-canceled@example.com',
          passwordHash: 'hash',
        },
      });

      const cancelDate = new Date('2026-07-15');
      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.canceled,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
          canceledAt: cancelDate,
        },
      });

      expect(subscription.canceledAt).toEqual(cancelDate);
    });
  });

  describe('One Subscription Per User Constraint', () => {
    it('should enforce unique userId constraint', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-unique@example.com',
          passwordHash: 'hash',
        },
      });

      // Create first subscription
      await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      // Attempt to create second subscription for same user should fail
      await expect(
        prisma.subscription.create({
          data: {
            userId: user.id,
            plan: SubscriptionPlan.enterprise,
            status: SubscriptionStatus.active,
            startDate: new Date('2026-07-01'),
            endDate: new Date('2026-08-01'),
          },
        })
      ).rejects.toThrow();
    });

    it('should allow subscription upgrade by updating same record', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-upgrade@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      // Upgrade to enterprise plan
      const upgraded = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          plan: SubscriptionPlan.enterprise,
          endDate: new Date('2026-09-01'),
        },
      });

      expect(upgraded.id).toBe(subscription.id); // Same subscription record
      expect(upgraded.plan).toBe(SubscriptionPlan.enterprise);
      expect(upgraded.endDate).toEqual(new Date('2026-09-01'));
    });

    it('should allow subscription downgrade by updating same record', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-downgrade@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      // Downgrade to pro plan
      const downgraded = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          plan: SubscriptionPlan.pro,
        },
      });

      expect(downgraded.id).toBe(subscription.id); // Same subscription record
      expect(downgraded.plan).toBe(SubscriptionPlan.pro);
    });
  });

  describe('Subscription-User Relations', () => {
    it('should relate subscription to user', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-relation@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      const subWithUser = await prisma.subscription.findUnique({
        where: { id: subscription.id },
        include: { user: true },
      });

      expect(subWithUser?.user.id).toBe(user.id);
      expect(subWithUser?.user.email).toBe('test-sub-relation@example.com');
    });

    it('should access subscription from user relation', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-user-relation@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      const userWithSub = await prisma.user.findUnique({
        where: { id: user.id },
        include: { subscriptions: true },
      });

      expect(userWithSub?.subscriptions).toHaveLength(1);
      expect(userWithSub?.subscriptions[0].id).toBe(subscription.id);
      expect(userWithSub?.subscriptions[0].plan).toBe(SubscriptionPlan.enterprise);
    });
  });

  describe('Subscription-Payment Relations', () => {
    it('should support multiple payments for one subscription', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-payments@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      // Create multiple payments
      await prisma.payment.createMany({
        data: [
          {
            subscriptionId: subscription.id,
            amount: 29.00,
            currency: 'USD',
            status: 'completed',
            provider: 'stripe',
            externalId: 'pi_monthly_1',
          },
          {
            subscriptionId: subscription.id,
            amount: 29.00,
            currency: 'USD',
            status: 'completed',
            provider: 'stripe',
            externalId: 'pi_monthly_2',
          },
        ],
      });

      const subWithPayments = await prisma.subscription.findUnique({
        where: { id: subscription.id },
        include: { payments: true },
      });

      expect(subWithPayments?.payments).toHaveLength(2);
    });
  });

  describe('Subscription Status Transitions', () => {
    it('should transition from active to canceled', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-cancel@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      const canceled = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.canceled,
          canceledAt: new Date(),
        },
      });

      expect(canceled.status).toBe(SubscriptionStatus.canceled);
      expect(canceled.canceledAt).toBeInstanceOf(Date);
    });

    it('should transition from active to expired', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-expire@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-07-01'),
        },
      });

      const expired = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.expired,
        },
      });

      expect(expired.status).toBe(SubscriptionStatus.expired);
    });

    it('should support all SubscriptionStatus enum values', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-statuses@example.com',
          passwordHash: 'hash',
        },
      });

      // Test each status value
      for (const status of [
        SubscriptionStatus.active,
        SubscriptionStatus.canceled,
        SubscriptionStatus.expired,
        SubscriptionStatus.past_due,
      ]) {
        const subscription = await prisma.subscription.create({
          data: {
            userId: user.id,
            plan: SubscriptionPlan.pro,
            status,
            startDate: new Date('2026-07-01'),
            endDate: new Date('2026-08-01'),
          },
        });

        // Delete to allow creating next subscription (unique userId constraint)
        await prisma.subscription.delete({ where: { id: subscription.id } });
      }
    });
  });

  describe('Subscription Date Validations', () => {
    it('should handle subscription with future start date', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-future@example.com',
          passwordHash: 'hash',
        },
      });

      const futureStart = new Date('2026-12-01');
      const futureEnd = new Date('2027-01-01');

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: futureStart,
          endDate: futureEnd,
        },
      });

      expect(subscription.startDate).toEqual(futureStart);
      expect(subscription.endDate).toEqual(futureEnd);
    });

    it('should query subscriptions expiring soon', async () => {
      const user1 = await prisma.user.create({
        data: {
          email: 'test-sub-expiring-1@example.com',
          passwordHash: 'hash',
        },
      });

      const user2 = await prisma.user.create({
        data: {
          email: 'test-sub-expiring-2@example.com',
          passwordHash: 'hash',
        },
      });

      // Subscription expiring tomorrow
      await prisma.subscription.create({
        data: {
          userId: user1.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-07-09'), // Tomorrow
        },
      });

      // Subscription expiring in 30 days
      await prisma.subscription.create({
        data: {
          userId: user2.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-08'),
        },
      });

      const tomorrow = new Date('2026-07-09');
      tomorrow.setHours(23, 59, 59, 999);

      const expiringSoon = await prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.active,
          endDate: { lte: tomorrow },
        },
      });

      expect(expiringSoon).toHaveLength(1);
      expect(expiringSoon[0].userId).toBe(user1.id);
    });
  });

  describe('Subscription Cascade Behavior', () => {
    it('should cascade delete payments when subscription is deleted', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-cascade@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      const payment = await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: 29.00,
          currency: 'USD',
          status: 'completed',
          provider: 'stripe',
          externalId: 'pi_cascade_test',
        },
      });

      // Delete subscription
      await prisma.subscription.delete({ where: { id: subscription.id } });

      // Verify payment was cascade deleted
      const orphanedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });

      expect(orphanedPayment).toBeNull();
    });

    it('should cascade delete subscription when user is deleted', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-sub-user-cascade@example.com',
          passwordHash: 'hash',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      // Delete user
      await prisma.user.delete({ where: { id: user.id } });

      // Verify subscription was cascade deleted
      const orphanedSub = await prisma.subscription.findUnique({
        where: { id: subscription.id },
      });

      expect(orphanedSub).toBeNull();
    });
  });

  describe('Subscription Queries', () => {
    it('should query subscriptions by plan', async () => {
      const user1 = await prisma.user.create({
        data: {
          email: 'test-sub-query-plan-1@example.com',
          passwordHash: 'hash',
        },
      });

      const user2 = await prisma.user.create({
        data: {
          email: 'test-sub-query-plan-2@example.com',
          passwordHash: 'hash',
        },
      });

      await prisma.subscription.create({
        data: {
          userId: user1.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      await prisma.subscription.create({
        data: {
          userId: user2.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      const proSubs = await prisma.subscription.findMany({
        where: { 
          plan: SubscriptionPlan.pro,
          user: { email: { startsWith: 'test-sub-' } }
        },
      });

      expect(proSubs).toHaveLength(1);
      expect(proSubs[0].plan).toBe(SubscriptionPlan.pro);
    });

    it('should query subscriptions by status', async () => {
      const user1 = await prisma.user.create({
        data: {
          email: 'test-sub-query-status-1@example.com',
          passwordHash: 'hash',
        },
      });

      const user2 = await prisma.user.create({
        data: {
          email: 'test-sub-query-status-2@example.com',
          passwordHash: 'hash',
        },
      });

      await prisma.subscription.create({
        data: {
          userId: user1.id,
          plan: SubscriptionPlan.pro,
          status: SubscriptionStatus.active,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-08-01'),
        },
      });

      await prisma.subscription.create({
        data: {
          userId: user2.id,
          plan: SubscriptionPlan.enterprise,
          status: SubscriptionStatus.canceled,
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-07-01'),
          canceledAt: new Date('2026-06-15'),
        },
      });

      const activeSubs = await prisma.subscription.findMany({
        where: { 
          status: SubscriptionStatus.active,
          user: { email: { startsWith: 'test-sub-' } }
        },
      });

      expect(activeSubs).toHaveLength(1);
      expect(activeSubs[0].status).toBe(SubscriptionStatus.active);
    });
  });
});
