import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { PrismaClient, UserRole, SubscriptionPlan } from '@prisma/client';

const prisma = new PrismaClient();

describe('User Model Tests', () => {
  beforeEach(async () => {
    // Clean up test data before each test to ensure isolation
    await prisma.payment.deleteMany({ where: { subscription: { user: { email: { startsWith: 'test-user-' } } } } });
    await prisma.subscription.deleteMany({ where: { user: { email: { startsWith: 'test-user-' } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'test-user-' } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('User Creation', () => {
    it('should create user with default free role', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-user-default@example.com',
          passwordHash: 'test-hash',
        },
      });

      expect(user.role).toBe(UserRole.free);
      expect(user.plan).toBe(SubscriptionPlan.free);
      expect(user.planStartedAt).toBeNull();
      expect(user.planExpiresAt).toBeNull();
      expect(user.stripeCustomerId).toBeNull();
      expect(user.apiUsageCount).toBe(0);
    });

    it('should create user with explicit role', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-user-pro@example.com',
          passwordHash: 'test-hash',
          role: UserRole.pro,
        },
      });

      expect(user.role).toBe(UserRole.pro);
    });

    it('should create user with subscription fields', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days

      const user = await prisma.user.create({
        data: {
          email: 'test-user-subscribed@example.com',
          passwordHash: 'test-hash',
          role: UserRole.pro,
          plan: SubscriptionPlan.pro,
          planStartedAt: now,
          planExpiresAt: futureDate,
          stripeCustomerId: 'cus_test123',
        },
      });

      expect(user.plan).toBe(SubscriptionPlan.pro);
      expect(user.planStartedAt?.getTime()).toBe(now.getTime());
      expect(user.planExpiresAt?.getTime()).toBe(futureDate.getTime());
      expect(user.stripeCustomerId).toBe('cus_test123');
    });
  });

  describe('User-Subscription Relations', () => {
    it('should create user with subscription relation', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const user = await prisma.user.create({
        data: {
          email: 'test-user-with-sub@example.com',
          passwordHash: 'test-hash',
          role: UserRole.pro,
          plan: SubscriptionPlan.pro,
          subscriptions: {
            create: {
              plan: SubscriptionPlan.pro,
              status: 'active',
              startDate: now,
              endDate: futureDate,
            },
          },
        },
        include: {
          subscriptions: true,
        },
      });

      expect(user.subscriptions).toHaveLength(1);
      expect(user.subscriptions[0].plan).toBe(SubscriptionPlan.pro);
      expect(user.subscriptions[0].status).toBe('active');
    });

    it('should fetch user with subscriptions', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const created = await prisma.user.create({
        data: {
          email: 'test-user-fetch@example.com',
          passwordHash: 'test-hash',
          role: UserRole.enterprise,
          subscriptions: {
            create: {
              plan: SubscriptionPlan.enterprise,
              status: 'active',
              startDate: now,
              endDate: futureDate,
            },
          },
        },
      });

      const fetched = await prisma.user.findUnique({
        where: { id: created.id },
        include: {
          subscriptions: true,
        },
      });

      expect(fetched).not.toBeNull();
      expect(fetched?.subscriptions).toHaveLength(1);
      expect(fetched?.subscriptions[0].userId).toBe(created.id);
    });

    it('should delete subscriptions when user is deleted (CASCADE)', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const user = await prisma.user.create({
        data: {
          email: 'test-user-cascade@example.com',
          passwordHash: 'test-hash',
          subscriptions: {
            create: {
              plan: SubscriptionPlan.pro,
              status: 'active',
              startDate: now,
              endDate: futureDate,
            },
          },
        },
        include: {
          subscriptions: true,
        },
      });

      const subscriptionId = user.subscriptions[0].id;

      await prisma.user.delete({ where: { id: user.id } });

      const orphanedSub = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });

      expect(orphanedSub).toBeNull();
    });
  });

  describe('API Usage Tracking', () => {
    it('should increment apiUsageCount', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-user-usage@example.com',
          passwordHash: 'test-hash',
          apiUsageCount: 0,
        },
      });

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          apiUsageCount: { increment: 1 },
        },
      });

      expect(updated.apiUsageCount).toBe(1);
    });

    it('should reset apiUsageCount and update lastApiUsageReset', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'test-user-reset@example.com',
          passwordHash: 'test-hash',
          apiUsageCount: 50,
        },
      });

      const now = new Date();
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          apiUsageCount: 0,
          lastApiUsageReset: now,
        },
      });

      expect(updated.apiUsageCount).toBe(0);
      expect(updated.lastApiUsageReset?.getTime()).toBe(now.getTime());
    });
  });

  describe('Stripe Customer ID', () => {
    it('should enforce unique stripeCustomerId constraint', async () => {
      await prisma.user.create({
        data: {
          email: 'test-user-stripe1@example.com',
          passwordHash: 'test-hash',
          stripeCustomerId: 'cus_unique123',
        },
      });

      await expect(
        prisma.user.create({
          data: {
            email: 'test-user-stripe2@example.com',
            passwordHash: 'test-hash',
            stripeCustomerId: 'cus_unique123',
          },
        })
      ).rejects.toThrow();
    });

    it('should allow null stripeCustomerId for multiple users', async () => {
      const user1 = await prisma.user.create({
        data: {
          email: 'test-user-null1@example.com',
          passwordHash: 'test-hash',
          stripeCustomerId: null,
        },
      });

      const user2 = await prisma.user.create({
        data: {
          email: 'test-user-null2@example.com',
          passwordHash: 'test-hash',
          stripeCustomerId: null,
        },
      });

      expect(user1.stripeCustomerId).toBeNull();
      expect(user2.stripeCustomerId).toBeNull();
    });
  });

  describe('Role Enum Validation', () => {
    it('should accept all valid UserRole enum values', async () => {
      // Create users with different role values
      const freeUser = await prisma.user.create({
        data: {
          email: 'test-user-role-free@example.com',
          passwordHash: 'hash',
          role: UserRole.free,
        },
      });

      const proUser = await prisma.user.create({
        data: {
          email: 'test-user-role-pro@example.com',
          passwordHash: 'hash',
          role: UserRole.pro,
        },
      });

      const enterpriseUser = await prisma.user.create({
        data: {
          email: 'test-user-role-enterprise@example.com',
          passwordHash: 'hash',
          role: UserRole.enterprise,
        },
      });

      expect(freeUser.role).toBe(UserRole.free);
      expect(proUser.role).toBe(UserRole.pro);
      expect(enterpriseUser.role).toBe(UserRole.enterprise);
    });
  });
});
