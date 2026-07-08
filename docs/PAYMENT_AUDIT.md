# Payment System Audit — 2026-07-07

## Executive Summary

**Current Status**: Infrastructure exists but **NOT PRODUCTION READY**  
**Critical Gap**: No subscription management, no paywall enforcement, no user panel

---

## ✅ What EXISTS (Working)

### 1. Payment Gateway Infrastructure
**Location**: `src/lib/payments/`

Four fully-implemented providers with proper signature verification:

| Provider | Markets | Methods | Status |
|----------|---------|---------|--------|
| **Tripay** | Indonesia | QRIS, VA, Alfamart | ✅ Complete |
| **Midtrans** | Indonesia | Cards, QRIS, Gopay, OVO, Dana | ✅ Complete |
| **Duitku** | Indonesia | VA, Alfamart, Indomaret | ✅ Complete |
| **NOWPayments** | Global | BTC, ETH, USDT, SOL | ✅ Complete |

All implement `PaymentProvider` interface:
- `createPayment(amount, currency, metadata)` → Payment URL
- `verifyWebhook(signature, payload)` → Boolean
- `checkStatus(paymentId)` → Payment status

### 2. Payment API Endpoints
**Location**: `src/app/api/v1/`

- **POST `/api/v1/payments`** — Creates payment via selected gateway
  - Converts USD→IDR (×15500) for Indonesian gateways
  - Returns payment URL + tracking ID
  
- **POST `/api/v1/webhooks/[gateway]`** — Verifies webhook signatures
  - Updates `Payment.status` in database
  - ✅ Signature verification working for all 4 providers

- **POST `/api/v1/checkout`** — Stripe integration (MOCK when not configured)

### 3. Database Schema
**Location**: `prisma/schema.prisma`

```prisma
model Payment {
  id              String   @id @default(cuid())
  amount          Float
  currency        String
  status          String   // pending, success, failed, expired
  gateway         String
  gatewayOrderId  String?
  checkoutUrl     String?
  metadata        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 4. Pricing Page UI
**Location**: `src/app/pricing/page.tsx`

Displays 3 tiers with payment method selector:
- **Free** — $0/month
- **Pro** — $29/month (Rp449,500)
- **Enterprise** — $99/month (custom quote)

---

## ❌ Critical GAPS (Blocking Production)

### 1. NO SUBSCRIPTION MODEL
**Current**: Only `User.role` field (default: "free")  
**Missing**:
- Plan tracking (free/pro/enterprise)
- Renewal dates (`planExpiresAt`)
- Cancellation logic
- Grace period handling
- Subscription status (active/cancelled/expired)

**Impact**: Cannot track who has paid, when plans expire, or enforce renewals.

### 2. NO PAYWALL ENFORCEMENT
**Current**: All API routes publicly accessible  
**Missing**:
- Middleware to check `User.plan` before serving data
- Feature gating (e.g., Pro gets 100 signals, Free gets 10)
- Quota enforcement (API rate limits per plan)

**Example**: `/api/v1/signals/history` returns ALL 273 signals regardless of user plan.

### 3. NO USER ACCOUNT PANEL
**Current**: No `/account` or `/dashboard` route  
**Missing**:
- View current plan status
- Payment history table
- Upgrade/downgrade buttons
- Cancel subscription flow
- Invoice downloads

**Impact**: Users cannot self-serve after payment.

### 4. INCOMPLETE CHECKOUT FLOW
**Current**: `/api/v1/checkout` returns mock when Stripe not configured  
**Missing**:
- Stripe subscription creation
- Trial period logic
- Proration for upgrades/downgrades
- Webhook to create `Subscription` record

### 5. NO EMAIL NOTIFICATIONS
**Missing**:
- Payment confirmation emails
- Renewal reminders (7 days before expiry)
- Cancellation confirmations
- Receipt/invoice generation

### 6. NO ADMIN PANEL FOR SUBSCRIPTIONS
**Missing**:
- View all subscriptions
- Manually grant/revoke access
- Refund processing
- Override expiry dates

---

## 🚀 Implementation Plan (4 Phases)

### Phase 1: Database Schema (1 day)
**Goal**: Add subscription tracking to database

**Tasks**:
1. ✅ Create `prisma/migrations/add_subscriptions.sql` (DONE in this session)
2. Run migration: `npx prisma migrate dev --name add_subscriptions`
3. Update `prisma/schema.prisma` with new fields:
   ```prisma
   model User {
     plan             String   @default("free")
     planStartedAt    DateTime?
     planExpiresAt    DateTime?
     stripeCustomerId String?
     subscriptions    Subscription[]
   }
   
   model Subscription {
     id              String   @id @default(cuid())
     userId          String
     plan            String   // free, pro, enterprise
     status          String   // active, cancelled, expired
     startedAt       DateTime @default(now())
     expiresAt       DateTime?
     cancelledAt     DateTime?
     paymentGateway  String
     paymentId       String?
     user            User     @relation(...)
     payment         Payment? @relation(...)
   }
   ```
4. Regenerate Prisma client: `npx prisma generate`

**Verification**: Query `SELECT * FROM "Subscription"` succeeds.

---

### Phase 2: Paywall Middleware (2 days)
**Goal**: Enforce plan limits on API routes

**Tasks**:
1. Create `src/lib/auth/check-plan.ts`:
   ```typescript
   export function checkPlanAccess(user: User, requiredPlan: string) {
     if (!user.planExpiresAt || user.planExpiresAt < new Date()) {
       throw new Error('Subscription expired');
     }
     const plans = ['free', 'pro', 'enterprise'];
     if (plans.indexOf(user.plan) < plans.indexOf(requiredPlan)) {
       throw new Error('Upgrade required');
     }
   }
   ```

2. Update `/api/v1/signals/history/route.ts`:
   ```typescript
   const user = await getUser(req);
   checkPlanAccess(user, 'pro'); // Block free users
   
   // Apply quota limits
   const limit = user.plan === 'pro' ? 100 : 10;
   ```

3. Add `/api/v1/user/quota` endpoint to show remaining API calls.

4. Create `src/middleware/plan-gate.ts` to auto-check all protected routes.

**Verification**: Free user gets 403 when accessing Pro features.

---

### Phase 3: User Account Panel (3 days)
**Goal**: Users can view/manage subscriptions

**Tasks**:
1. Create `/app/account/page.tsx`:
   - Show current plan (Free/Pro/Enterprise)
   - Display expiry date
   - List payment history (table from `Subscription` model)
   - "Upgrade" button → `/pricing`
   - "Cancel" button → confirmation modal

2. Create `/app/account/billing/page.tsx`:
   - Payment method management (Stripe only)
   - Download invoices (PDF generation)

3. Create `/api/v1/subscriptions/cancel` endpoint:
   ```typescript
   POST /api/v1/subscriptions/cancel
   Body: { subscriptionId: string }
   → Sets cancelledAt, expiresAt = end of billing period
   ```

4. Add "Manage Subscription" link to navbar when logged in.

**Verification**: User can view plan, see history, cancel without errors.

---

### Phase 4: Checkout & Webhooks (3 days)
**Goal**: Working end-to-end payment flow

**Tasks**:
1. Fix `/api/v1/checkout/route.ts`:
   - Create Stripe subscription (not one-time payment)
   - Store `stripeCustomerId` and `stripeSubscriptionId`
   - Return Stripe checkout session URL

2. Create subscription on successful payment:
   ```typescript
   // In webhook handler after payment success
   await prisma.subscription.create({
     data: {
       userId: payment.metadata.userId,
       plan: payment.metadata.plan,
       status: 'active',
       expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
       paymentGateway: payment.gateway,
       paymentId: payment.id,
     }
   });
   
   // Update User.plan and User.planExpiresAt
   await prisma.user.update({
     where: { id: payment.metadata.userId },
     data: {
       plan: payment.metadata.plan,
       planStartedAt: new Date(),
       planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
     }
   });
   ```

3. Handle Stripe webhook events:
   - `invoice.payment_succeeded` → Renew subscription
   - `customer.subscription.deleted` → Cancel subscription
   - `invoice.payment_failed` → Grace period (7 days)

4. Test all 4 payment gateways in sandbox:
   - Tripay: Create QRIS payment, scan with test app
   - Midtrans: Use test card 4811 1111 1111 1114
   - Duitku: Use sandbox credentials
   - NOWPayments: Create test BTC payment

**Verification**: 
- User clicks "Upgrade to Pro" → redirected to payment
- After payment → `User.plan` = "pro", `/account` shows active subscription
- Webhook updates database without errors

---

### Phase 5: Email Notifications (2 days)
**Goal**: Automated email for payment events

**Tasks**:
1. Install email provider (Resend recommended):
   ```bash
   npm install resend
   ```

2. Create `src/lib/email/templates.ts`:
   - `sendPaymentConfirmation(email, plan, amount)`
   - `sendRenewalReminder(email, expiresAt)`
   - `sendCancellationConfirmation(email, expiresAt)`

3. Trigger emails in webhook handler:
   ```typescript
   if (payment.status === 'success') {
     await sendPaymentConfirmation(user.email, plan, amount);
   }
   ```

4. Create cron job (`/api/cron/check-expiring-subscriptions`):
   - Runs daily
   - Sends reminder 7 days before expiry
   - Cancels expired subscriptions

**Verification**: Test payment triggers email to real inbox.

---

### Phase 6: Admin Panel (2 days)
**Goal**: Manual subscription management

**Tasks**:
1. Create `/app/admin/subscriptions/page.tsx`:
   - Table of all subscriptions with filters
   - Search by email/user ID
   - Status badges (active/cancelled/expired)

2. Create admin actions:
   - `POST /api/v1/admin/subscriptions/[id]/extend` — Add 30 days
   - `POST /api/v1/admin/subscriptions/[id]/cancel` — Force cancel
   - `POST /api/v1/admin/subscriptions/[id]/refund` — Mark for refund

3. Add `User.role = "admin"` check to all admin routes.

4. Create audit log:
   ```prisma
   model SubscriptionLog {
     id        String   @id @default(cuid())
     subId     String
     action    String   // created, extended, cancelled, refunded
     adminId   String?
     reason    String?
     createdAt DateTime @default(now())
   }
   ```

**Verification**: Admin user can view all subs, extend expiry dates.

---

## 📋 Pre-Launch Checklist

Before enabling payments in production:

### Security
- [ ] Environment variables secured (`.env.local` not in git)
- [ ] Webhook signature verification tested for all 4 gateways
- [ ] CSRF protection active on all payment routes
- [ ] Rate limiting on `/api/v1/checkout` (prevent abuse)
- [ ] SQL injection prevention (Prisma parameterized queries)

### Testing
- [ ] Sandbox payments successful for Tripay, Midtrans, Duitku, NOWPayments
- [ ] Webhook retry logic (if first attempt fails)
- [ ] Subscription expiry cron job runs correctly
- [ ] Email notifications sent to real inbox
- [ ] Refund flow tested end-to-end

### Legal
- [ ] Terms of Service updated with refund policy
- [ ] Privacy Policy mentions payment data storage
- [ ] Indonesian consumer protection compliance (if selling in Indonesia)

### Monitoring
- [ ] Sentry error tracking for payment routes
- [ ] Slack/email alerts for failed webhooks
- [ ] Daily report of new subscriptions
- [ ] Monthly revenue dashboard

---

## 🔧 Quick Fixes (Can Do Today)

### 1. Add "Subscribe" Button to Pricing Page
**File**: `src/app/pricing/page.tsx`  
**Change**: Link "Get Started" button to `/api/v1/checkout?plan=pro`

### 2. Show Current Plan on Dashboard
**File**: `src/app/alpha-engine/page.tsx`  
**Add**: Badge showing "Free Plan" or "Pro Plan" in header

### 3. Block Free Users from History API
**File**: `src/app/api/v1/signals/history/route.ts`  
**Add**:
```typescript
const user = await getUser(req);
if (user.plan === 'free') {
  return NextResponse.json(
    { error: 'Upgrade to Pro to view full history' },
    { status: 403 }
  );
}
```

---

## 💰 Estimated Timeline

| Phase | Duration | Blocker |
|-------|----------|---------|
| 1. Database Schema | 1 day | None |
| 2. Paywall Middleware | 2 days | Phase 1 |
| 3. User Account Panel | 3 days | Phase 1 |
| 4. Checkout & Webhooks | 3 days | Phase 1 |
| 5. Email Notifications | 2 days | Phase 4 |
| 6. Admin Panel | 2 days | Phase 1 |
| **Total** | **13 days** | — |

**Parallelization**: Phases 2, 3, 4 can run in parallel after Phase 1 completes.

**Minimum Viable Product (MVP)**: Phases 1-4 (9 days)

---

## 🎯 Answer to User's Question

> "where is the paid wall? where is the subscribe button? where is the user panel?"

### Current Answer: **NONE OF THEM EXIST**

1. **Paywall**: No enforcement. All API routes are public.
2. **Subscribe Button**: Pricing page shows buttons but they do nothing (checkout returns mock).
3. **User Panel**: No `/account` route. Users have no way to view/manage subscriptions.

### To Make It Work:
1. Run Phase 1 migration (add `Subscription` table)
2. Fix `/api/v1/checkout` to create real Stripe subscriptions
3. Build `/app/account` page with plan status + cancel button
4. Add middleware to block free users from Pro features

**ETA to working paywall**: 9 days (Phases 1-4)

---

## 📞 Next Steps

**Immediate**: Choose a path:
1. **Quick Fix** (2 hours) — Add paywall to one route, show plan badge
2. **MVP** (9 days) — Full implementation Phases 1-4
3. **Full Launch** (13 days) — All phases including emails + admin panel

**Recommendation**: Start with Phase 1 migration TODAY. Everything else depends on it.
