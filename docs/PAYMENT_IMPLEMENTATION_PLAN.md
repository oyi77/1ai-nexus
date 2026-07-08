# Payment System Implementation Plan — Atomic PRs with Review Gates

**Created**: 2026-07-07  
**Status**: PLANNING  
**Scope**: COMPLEX (multi-phase, high-risk auth/billing changes)  
**Framework**: 1ai-rules 8-step MANDATORY PROCESS + GATE.md compliance

---

## Executive Summary

Transform existing payment infrastructure (4 gateways, pricing page, webhook handlers) into production-ready subscription system with:
- Database-backed subscription tracking
- Route-level paywall enforcement
- User account management panel
- Complete checkout flow
- Email notifications
- Admin subscription management

**Timeline**: 13 days (9 days MVP)  
**Approach**: 7 atomic PRs, each with fresh-agent review gate  
**Risk Level**: HIGH (auth changes, data migrations, billing logic)

---

## Phase Breakdown — 7 Atomic PRs

### PR #1: Database Schema Migration (Day 1) — FOUNDATION
**Scope**: STANDARD  
**Risk**: MEDIUM (database migration, reversible)  
**Dependencies**: None  
**Blocks**: All other PRs

**Changes**:
- Add `Subscription` table (id, userId, plan, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, createdAt, updatedAt)
- Add fields to `User`: plan, planStartedAt, planExpiresAt, stripeCustomerId, apiUsageCount, lastApiUsageReset
- Create indexes: userId, status, currentPeriodEnd
- Migration with down script

**Deliverables**:
- `prisma/migrations/YYYYMMDDHHMMSS_add_subscriptions/migration.sql`
- Updated `prisma/schema.prisma`
- Rollback script: `prisma/migrations/YYYYMMDDHHMMSS_add_subscriptions/down.sql`

**Test Plan**:
- Migration runs without errors
- Rollback script reverses migration
- No existing data lost
- All queries still work

**Review Gate**: Fresh agent verifies migration safety, rollback plan, zero data loss

---

### PR #2: Subscription Service Layer (Day 2-3) — BUSINESS LOGIC
**Scope**: STANDARD  
**Risk**: MEDIUM (core business logic, no user-facing changes yet)  
**Dependencies**: PR #1  
**Blocks**: PR #3, #4, #5

**Changes**:
- `src/lib/modules/billing/subscription-service.ts`:
  - `createSubscription(userId, plan, gateway, transactionId)`
  - `getActiveSubscription(userId)`
  - `cancelSubscription(subscriptionId)`
  - `renewSubscription(subscriptionId)`
  - `isSubscriptionActive(userId)`
  - `getSubscriptionStatus(userId)` → {plan, status, expiresAt, daysRemaining}
- `src/lib/modules/billing/plan-limits.ts`:
  - Plan definitions (Free/Pro/Enterprise)
  - Feature limits per plan
  - Usage quota tracking
- Unit tests: 15+ test cases covering all methods

**Deliverables**:
- Subscription service with full CRUD
- Plan configuration
- 100% test coverage for service layer
- TypeScript types exported

**Test Plan**:
- Unit tests: 15/15 pass
- Edge cases: expired, cancelled, free user
- Concurrent renewal handling
- Invalid plan rejection

**Review Gate**: Fresh agent audits business logic correctness, edge case coverage, type safety

---

### PR #3: API Paywall Middleware (Day 4) — ENFORCEMENT
**Scope**: STANDARD  
**Risk**: HIGH (auth changes, could break existing API access)  
**Dependencies**: PR #2  
**Blocks**: PR #5

**Changes**:
- `src/middleware/paywall.ts`:
  - Check subscription status before API access
  - Return 402 Payment Required for free users on protected routes
  - Track API usage count
  - Rate limiting per plan
- `src/middleware.ts`:
  - Integrate paywall check AFTER CSRF validation
  - Define protected routes: `/api/v1/signals/history`, `/api/v1/backtest`, `/api/v1/alpha-engine`
  - Public routes: `/api/v1/auth/*`, `/api/v1/payments/*`, `/api/v1/webhooks/*`
- Feature flag: `ENABLE_PAYWALL` (default: false)

**Deliverables**:
- Paywall middleware with plan-based access control
- Feature flag for safe rollout
- Integration tests: protected routes return 402 for free users
- Public routes still accessible

**Test Plan**:
- Happy path: Pro user accesses history → 200 OK
- Sad path: Free user accesses history → 402 Payment Required
- Happy path: Free user accesses auth → 200 OK (public route)
- Sad path: Expired subscription → 402 Payment Required
- Feature flag OFF: no paywall enforcement

**Review Gate**: Fresh agent verifies no existing API breaks, rollback plan via flag, security audit

---

### PR #4: User Account Panel (Day 5-6) — USER INTERFACE
**Scope**: STANDARD  
**Risk**: LOW (new UI, no existing changes)  
**Dependencies**: PR #2  
**Blocks**: None

**Changes**:
- `/app/account/page.tsx`:
  - Display current plan (Free/Pro/Enterprise)
  - Show subscription status, renewal date, days remaining
  - Cancel subscription button (end at period end)
  - Upgrade/downgrade links to pricing page
  - API usage stats
- `/app/account/billing/page.tsx`:
  - Payment history table
  - Invoice downloads
- `/components/PlanBadge.tsx`:
  - Reusable badge component
- Navigation: Add "Account" link to header

**Deliverables**:
- User account dashboard
- Billing history page
- Plan badge component
- E2E test: user views account, sees correct plan

**Test Plan**:
- Happy path: Pro user sees "Pro Plan" badge, renewal date
- Happy path: Free user sees "Upgrade" CTA
- Sad path: Expired user sees "Renew" CTA
- Cancel button shows confirmation modal
- Payment history loads correctly

**Review Gate**: Fresh agent reviews UI/UX completeness, accessibility, mobile responsiveness

---

### PR #5: Complete Checkout Flow (Day 7-8) — PAYMENT INTEGRATION
**Scope**: COMPLEX  
**Risk**: HIGH (payment flow, real money, gateway integration)  
**Dependencies**: PR #2, PR #3  
**Blocks**: None

**Changes**:
- `/api/v1/checkout/route.ts`:
  - Remove mock response
  - Integrate all 4 gateways (Tripay, Midtrans, Duitku, NOWPayments)
  - Create pending payment record
  - Return redirect URL to gateway checkout page
- `/api/v1/webhooks/[gateway]/route.ts`:
  - On payment success: create subscription record
  - Set user plan, expiry date
  - Send confirmation email (stub for now)
- `/app/checkout/success/page.tsx`:
  - Success page after payment
  - Link to account dashboard
- `/app/checkout/cancel/page.tsx`:
  - Cancel page with retry option

**Deliverables**:
- Working checkout flow for all 4 gateways
- Webhook creates subscription on success
- Success/cancel pages
- Integration test: mock payment → subscription created

**Test Plan**:
- Happy path: Select Pro plan → redirect to gateway → mock success webhook → subscription active
- Sad path: Payment cancelled → no subscription, can retry
- Sad path: Webhook signature invalid → reject, no subscription
- Test all 4 gateways independently
- Currency conversion correct (USD → IDR ×15500)

**Review Gate**: Fresh agent audits payment security, webhook signature verification, idempotency, rollback plan

---

### PR #6: Email Notifications (Day 9-10) — COMMUNICATION
**Scope**: STANDARD  
**Risk**: LOW (email is async, non-blocking)  
**Dependencies**: PR #5  
**Blocks**: None

**Changes**:
- `src/lib/modules/email/email-service.ts`:
  - Email provider abstraction (Resend/SendGrid)
  - Template system
- Email templates:
  - Payment confirmation
  - Subscription activated
  - Subscription expiring (7 days before)
  - Subscription expired
  - Subscription cancelled
- Cron job: daily check for expiring subscriptions → send reminder

**Deliverables**:
- Email service with 5 templates
- Cron job for expiry reminders
- Test: mock email sending, verify correct recipient/content

**Test Plan**:
- Happy path: Payment success → confirmation email sent
- Happy path: 7 days before expiry → reminder sent
- Sad path: Email provider down → log error, don't block payment
- Verify unsubscribe link in all emails

**Review Gate**: Fresh agent reviews email content, spam compliance, unsubscribe mechanism

---

### PR #7: Admin Subscription Management (Day 11-13) — OPERATIONS
**Scope**: STANDARD  
**Risk**: MEDIUM (admin panel, high privilege)  
**Dependencies**: PR #2  
**Blocks**: None

**Changes**:
- `/app/admin/subscriptions/page.tsx`:
  - List all subscriptions (paginated)
  - Filter: active/expired/cancelled, by plan
  - Search by user email
- `/app/admin/subscriptions/[id]/page.tsx`:
  - View subscription details
  - Manual actions: extend, cancel, refund, change plan
- `/api/v1/admin/subscriptions/route.ts`:
  - Admin API for subscription management
  - Requires admin role
- Audit log: record all admin actions

**Deliverables**:
- Admin subscription dashboard
- Manual override capabilities
- Audit log table
- RBAC: only admin role can access

**Test Plan**:
- Happy path: Admin extends subscription → expiry date updated
- Happy path: Admin cancels subscription → status = cancelled
- Sad path: Non-admin accesses admin panel → 403 Forbidden
- Audit log records all actions with timestamp, admin email

**Review Gate**: Fresh agent audits RBAC enforcement, audit logging, no privilege escalation

---

## Review Protocol

### For Each PR (GATE 15 Compliance)

1. **PR Author** (you, following PROCESS.md):
   - Complete 8-step process (AUDIT → THINK → BRAINSTORM → PLAN → EXECUTE → TEST → VERIFY → REVIEW)
   - Pass all GATE.md checklist items (0-14)
   - Create PR with `~/.1ai/core/PRD.md` template:
     - Summary of changes
     - Issue reference (Closes #NNN)
     - How to test
     - QA results (happy + sad paths, all PASS)
     - Checklist (compile, tests, verify, docs updated)

2. **Fresh Agent Review** (spawned via `task` tool):
   - Run `~/.1ai/core/REVIEWER.md` protocol
   - No prior context from implementation
   - Verdict: APPROVED / APPROVED WITH CONDITIONS / CHANGES REQUIRED
   - Document findings in PR comments

3. **Merge Gate**:
   - APPROVED or APPROVED WITH CONDITIONS → merge
   - CHANGES REQUIRED → fix all BLOCK findings → re-review → merge
   - No self-approval, no merge without review

---

## Feature Flags

All PRs with HIGH-RISK changes MUST use feature flags (GATE 11):

- `ENABLE_PAYWALL` (PR #3) — Default: `false`
- `ENABLE_CHECKOUT` (PR #5) — Default: `false`
- `ENABLE_SUBSCRIPTION_EMAILS` (PR #6) — Default: `false`

**Rollout Plan**:
1. Deploy all PRs with flags OFF
2. Enable `ENABLE_CHECKOUT` → test checkout flow
3. Enable `ENABLE_PAYWALL` → monitor API usage
4. Enable `ENABLE_SUBSCRIPTION_EMAILS` → monitor email delivery

---

## Rollback Plans

### PR #1 (Database):
```sql
-- Run down migration
npx prisma migrate resolve --rolled-back YYYYMMDDHHMMSS_add_subscriptions
-- Verify User table unchanged
SELECT id, email, role FROM "User" LIMIT 1;
```

### PR #3 (Paywall):
```bash
# Set flag in .env.local
ENABLE_PAYWALL=false
# Restart app
pm2 restart tracker
# Verify API accessible
curl -H "x-csrf-token: xxx" http://localhost:4400/api/v1/signals/history
```

### PR #5 (Checkout):
```bash
# Set flag in .env.local
ENABLE_CHECKOUT=false
# Checkout returns "coming soon" message
# No new subscriptions created
```

---

## Success Metrics

### MVP (PR #1-5):
- [ ] Database migration applied, no data loss
- [ ] Subscription service unit tests: 15/15 pass
- [ ] Paywall blocks free users: `/api/v1/signals/history` → 402
- [ ] User account panel shows correct plan
- [ ] Checkout flow: payment → subscription active → account shows "Pro Plan"
- [ ] All 4 gateways tested independently
- [ ] Rollback plan verified for each PR

### Full Launch (PR #6-7):
- [ ] Payment confirmation emails sent
- [ ] Expiry reminder 7 days before renewal
- [ ] Admin can view/edit all subscriptions
- [ ] Audit log captures all admin actions

---

## Next Steps

1. **Create GitHub Issues** — One issue per PR with acceptance criteria
2. **Start with PR #1** — Database migration (foundation for everything else)
3. **Fresh Agent Review** — Each PR reviewed by new agent context
4. **Feature Flag Rollout** — Deploy with flags OFF, enable incrementally
5. **Production Verification** — QA scenarios on https://tracker.aitradepulse.com

---

**This plan follows 1ai-rules framework rigorously:**
- ✅ 8-step PROCESS.md for each PR
- ✅ 15-gate GATE.md pre-ship checklist
- ✅ Fresh agent review for COMPLEX tasks
- ✅ Feature flags for HIGH-RISK changes
- ✅ Rollback plans documented
- ✅ QA scenarios (happy + sad paths)
- ✅ No self-approval, no merge without review
