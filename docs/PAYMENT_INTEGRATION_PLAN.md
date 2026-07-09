# 1ai-payment Integration Plan

## Goal
Replace direct Stripe integration with `@1ai/payment` SDK to centralize payment gateway logic, support multiple payment providers, and simplify webhook handling.

## SDK Overview

**Package**: `@1ai/payment` (v1.0.0)  
**Location**: `~/projects/1ai-payment/packages/sdk/`  
**Build Status**: ✅ Compiled to `dist/` (ESM + CJS + types)

### SDK API Methods
```typescript
class OneAIPayment {
  constructor(options: { apiKey: string; baseUrl?: string })
  
  // Core payment operations
  async create(params: CreatePaymentParams): Promise<Order>
  async get(orderId: string): Promise<Order>
  
  // Transaction management
  async listTransactions(filters?: TransactionFilters): Promise<PaginatedTransactions>
  
  // Refund operations
  async refund(orderId: string, amount?: number, reason?: string): Promise<Refund>
  async listRefunds(limit?: number, offset?: number): Promise<PaginatedRefunds>
  
  // Gateway discovery
  async listGateways(): Promise<GatewayInfo[]>
}
```

### Key Interfaces
```typescript
interface CreatePaymentParams {
  amount: number;           // In smallest currency unit (cents)
  currency: string;         // ISO 4217 (IDR, USD, etc)
  gateway: string;          // 'midtrans' | 'tripay' | 'duitku' | ...
  order_id?: string;        // Auto-generated if not provided
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  metadata?: Record<string, unknown>; // Custom data preserved through lifecycle
  callback_url?: string;    // Optional success redirect
}

interface Order {
  id: string;              // Internal order ID
  order_id: string;        // External order ID
  amount: number;
  currency: string;
  gateway: string;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  payment_url: string;     // Redirect user here to pay
  expires_at: string;      // ISO 8601 timestamp
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

## Current State Analysis

### What We Have
- ✅ Prisma schema with `Payment`, `Subscription` models (PR #1)
- ✅ JWT auth routes + middleware (PR #1.5, PR #2)
- ✅ `/api/v1/checkout` route with Stripe fallback (lines 1-95)
- ✅ `/api/v1/payments` webhook handler stub (lines 1-28)
- ✅ Subscription-aware rate limiting (100/1K/10K req/hr)
- ✅ CSRF protection with ALWAYS_PUBLIC exemptions

### What Needs Change
- ❌ Checkout route uses direct Stripe API (`stripe.checkout.sessions.create`)
- ❌ Payment webhook only handles Stripe signature verification
- ❌ No multi-gateway support (locked to Stripe)
- ❌ Metadata not preserved through payment lifecycle
- ❌ No transaction history or refund support

## Integration Architecture

### Flow Diagram
```
User → POST /api/v1/checkout (JWT required)
  ↓
1ai-tracker creates payment via SDK
  ↓
1ai-payment service
  ↓
Selected gateway (Midtrans/Tripay/Stripe/etc)
  ↓
User completes payment at payment_url
  ↓
Gateway → POST /webhook/:gateway (1ai-payment)
  ↓
1ai-payment → POST /api/v1/webhooks/payment (1ai-tracker)
  ↓
Update Subscription status in DB
```

### Environment Variables Required
```bash
# Add to .env.local
ONEAI_PAYMENT_API_KEY=<service-to-service-key>
ONEAI_PAYMENT_BASE_URL=http://localhost:3100  # Dev
# ONEAI_PAYMENT_BASE_URL=https://pay.1ai.dev  # Prod
```

### Database Schema Updates
No schema changes needed — existing `Payment` model already has:
- `id`, `userId`, `amount`, `currency`, `status`
- `gateway` (varchar) — perfect for storing gateway name
- `metadata` (jsonb) — preserves custom data
- `createdAt`, `updatedAt`

## Implementation PRs

### PR #3: Install SDK + Environment Setup
**Files Changed**: 1  
**Complexity**: Low  

1. Install SDK package:
   ```bash
   cd ~/projects/1ai-payment/packages/sdk
   npm pack
   cd ~/projects/1ai-tracker
   npm install ~/projects/1ai-payment/packages/sdk/1ai-payment-sdk-1.0.0.tgz
   ```

2. Add environment variables to `.env.local`:
   ```
   ONEAI_PAYMENT_API_KEY=dev_key_12345
   ONEAI_PAYMENT_BASE_URL=http://localhost:3100
   ```

3. Verify installation:
   ```typescript
   import { OneAIPayment } from '@1ai/payment';
   console.log(typeof OneAIPayment); // 'function'
   ```

**Tests**: None (setup PR)  
**GATE.md**: Gates 0-3 (no build/runtime changes)

---

### PR #4: Replace Checkout Route with SDK
**Files Changed**: 2  
**Complexity**: Medium  

**Changes**:
1. `src/app/api/v1/checkout/route.ts` (95 lines → ~120 lines):
   - Remove Stripe dynamic import (lines 37-40)
   - Add `OneAIPayment` import + initialization
   - Replace `stripe.checkout.sessions.create()` with `payment.create()`
   - Map SDK `Order` response to Stripe session format for backward compat
   - Add gateway selection logic (default: 'midtrans' for IDR, 'stripe' for USD)

2. `src/app/api/v1/checkout/__tests__/route.test.ts` (new file, ~80 lines):
   - Test successful checkout creation
   - Test missing JWT token (401)
   - Test invalid plan selection (400)
   - Test payment service unavailable (503)
   - Test gateway-specific routing (IDR→midtrans, USD→stripe)
   - Mock SDK responses with `vi.mock('@1ai/payment')`

**Before (Stripe)**:
```typescript
const session = await stripe.checkout.sessions.create({
  payment_method_types: ['card'],
  line_items: [{ price: priceId, quantity: 1 }],
  mode: 'subscription',
  success_url: `${origin}/pricing?success=true`,
  cancel_url: `${origin}/pricing?canceled=true`,
  client_reference_id: userId,
});
return NextResponse.json({ sessionId: session.id, url: session.url });
```

**After (SDK)**:
```typescript
const payment = new OneAIPayment({
  apiKey: process.env.ONEAI_PAYMENT_API_KEY!,
  baseUrl: process.env.ONEAI_PAYMENT_BASE_URL,
});

const order = await payment.create({
  amount: planAmount * 100, // Convert to cents
  currency: 'IDR',
  gateway: 'midtrans',
  customer_email: userEmail,
  metadata: {
    userId,
    plan: selectedPlan,
    subscriptionId: subscription.id,
  },
  callback_url: `${origin}/pricing?success=true`,
});

// Map to Stripe format for backward compat
return NextResponse.json({
  sessionId: order.order_id,
  url: order.payment_url,
  orderId: order.id, // Internal tracking
});
```

**Rollback Plan**:
```bash
git revert HEAD  # Revert to Stripe implementation
```

**Tests**: 5 new tests (100% coverage)  
**GATE.md**: Gates 0-9 (build + runtime + manual test required)

---

### PR #5: Implement Unified Webhook Handler
**Files Changed**: 3  
**Complexity**: High  

**Changes**:
1. `src/app/api/v1/webhooks/payment/route.ts` (28 lines → ~150 lines):
   - Accept standardized event from 1ai-payment service
   - Validate `X-Webhook-Signature` header (HMAC-SHA256)
   - Parse event payload: `{ event, order_id, status, gateway, metadata }`
   - Extract `userId`, `plan`, `subscriptionId` from metadata
   - Update `Payment` record status
   - Activate/upgrade `Subscription` on `payment.success` event
   - Log all events to `PaymentLog` for audit trail

2. `src/lib/webhook-signature.ts` (new file, ~40 lines):
   - `verifyWebhookSignature(payload: string, signature: string, secret: string): boolean`
   - Uses `crypto.createHmac('sha256', secret).update(payload).digest('hex')`
   - Constant-time comparison to prevent timing attacks

3. `src/__tests__/api/v1/webhooks/payment.test.ts` (new file, ~120 lines):
   - Test payment.success event → subscription activated
   - Test payment.failed event → payment marked failed
   - Test payment.expired event → cleanup
   - Test invalid signature (403)
   - Test missing metadata (400)
   - Test duplicate event handling (idempotency)

**Event Format from 1ai-payment**:
```typescript
interface WebhookEvent {
  event: 'payment.success' | 'payment.failed' | 'payment.expired';
  order_id: string;       // External order ID
  internal_id: string;    // 1ai-payment database ID
  amount: number;
  currency: string;
  gateway: string;
  status: 'paid' | 'failed' | 'expired';
  metadata: Record<string, unknown>; // Our custom data
  paid_at?: string;       // ISO 8601 timestamp
  transaction_id?: string; // Gateway transaction ID
}
```

**Environment Variables**:
```bash
ONEAI_PAYMENT_WEBHOOK_SECRET=<shared-secret>
```

**Rollback Plan**:
```bash
git revert HEAD
# Revert to stub webhook handler
# No data corruption risk — events are replayable
```

**Tests**: 6 new tests (95% coverage)  
**GATE.md**: Gates 0-15 (full checklist + webhook manual test)

---

### PR #6: Add Transaction History UI
**Files Changed**: 4  
**Complexity**: Medium  

**Changes**:
1. `src/app/api/v1/payments/history/route.ts` (new file, ~80 lines):
   - GET endpoint for user transaction history
   - JWT-protected (user can only see their own payments)
   - Pagination support (limit/offset)
   - Filter by status, date range
   - Returns `Payment[]` with gateway info

2. `src/app/account/payments/page.tsx` (new file, ~150 lines):
   - Transaction history table
   - Shows: date, amount, gateway, status, actions
   - "View Receipt" button → modal with payment details
   - Filter controls: status, date range
   - Pagination controls

3. `src/components/TransactionTable.tsx` (new file, ~100 lines):
   - Reusable transaction list component
   - Status badges with color coding
   - Gateway icons
   - Amount formatting with currency symbol

4. `src/__tests__/api/v1/payments/history.test.ts` (new file, ~90 lines):
   - Test user can see own transactions
   - Test user cannot see others' transactions
   - Test pagination works
   - Test filters work
   - Test JWT required (401)

**Rollback Plan**:
```bash
git revert HEAD  # Safe — no DB changes, UI-only
```

**Tests**: 5 new tests (100% coverage)  
**GATE.md**: Gates 0-12 (build + runtime + UI manual test)

---

### PR #7: Add Refund Support
**Files Changed**: 3  
**Complexity**: High  

**Changes**:
1. `src/app/api/v1/refunds/route.ts` (new file, ~120 lines):
   - POST endpoint for creating refunds
   - Admin-only (requires `role: 'admin'`)
   - Validates refund amount ≤ original payment amount
   - Calls `payment.refund(orderId, amount, reason)`
   - Updates `Payment` record with refund info
   - Downgrades/cancels `Subscription` if full refund

2. `src/app/admin/refunds/page.tsx` (new file, ~180 lines):
   - Admin refund management UI
   - Search payments by order ID, user email
   - Refund form with amount validation
   - Reason text field (required)
   - Confirmation modal before processing
   - Refund history table

3. `src/__tests__/api/v1/refunds.test.ts` (new file, ~110 lines):
   - Test admin can create refunds
   - Test non-admin cannot create refunds (403)
   - Test partial refunds work
   - Test full refunds cancel subscription
   - Test refund amount validation
   - Test duplicate refund protection

**Rollback Plan**:
```bash
git revert HEAD
# Manual cleanup if refunds were processed:
# 1. Revert Payment.status in DB
# 2. Revert Subscription.status if changed
# 3. Contact gateway support for actual refund reversal
```

**Tests**: 6 new tests (100% coverage)  
**GATE.md**: Gates 0-15 (full checklist + admin UI test)

## Testing Strategy

### Unit Tests (Vitest)
- All SDK method calls mocked with `vi.mock('@1ai/payment')`
- Test success paths, error paths, validation
- Target: 100% line coverage for new code

### Integration Tests
- Spin up 1ai-payment service locally
- Use real SDK calls against local service
- Test full payment flow: create → webhook → subscription activation

### Manual QA Checklist
```
[ ] Create checkout session → redirects to payment URL
[ ] Complete payment at gateway → webhook received
[ ] Subscription activated → rate limits updated
[ ] Transaction appears in history UI
[ ] Admin can issue refunds
[ ] Gateway selection works (IDR→midtrans, USD→stripe)
```

## Rollback Strategy

### Per-PR Rollbacks
Each PR has specific rollback instructions above.

### Nuclear Option (Revert All)
```bash
# From PR #7 back to PR #3
git log --oneline | grep "feat(payment)" | head -5
# Copy commit hashes
git revert <hash-7> <hash-6> <hash-5> <hash-4> <hash-3>
git push origin main
```

### Data Recovery
- Payment records preserved in DB (soft delete, never hard delete)
- Transaction logs in `PaymentLog` table for audit trail
- Webhook events replayable from 1ai-payment service

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| 1ai-payment service down | High | Implement circuit breaker, fallback to Stripe |
| Webhook signature validation bypass | Critical | Use constant-time comparison, rotate secrets monthly |
| Gateway callback URL mismatch | Medium | Validate callback URLs in 1ai-payment service |
| Metadata loss during payment flow | Low | Test metadata preservation in integration tests |
| Race condition: webhook arrives before checkout response | Medium | Use idempotent subscription activation logic |

## Success Metrics

- ✅ Zero Stripe API calls after PR #4 merge
- ✅ 100% webhook signature validation pass rate
- ✅ <200ms p99 latency for checkout API
- ✅ Support ≥3 payment gateways (Midtrans, Tripay, Stripe)
- ✅ 100% test coverage for payment logic

## Dependencies

### Required Before Start
- [x] 1ai-payment service running locally (`http://localhost:3100`)
- [x] 1ai-payment API key generated
- [x] Webhook secret configured
- [ ] SDK package built (`npm run build` in sdk/ directory) — ✅ Already built

### Optional Enhancements (Post-MVP)
- [ ] Subscription upgrade/downgrade flow
- [ ] Proration calculations for mid-cycle changes
- [ ] Retry failed webhooks with exponential backoff
- [ ] Admin dashboard for payment analytics
- [ ] Multi-currency support with dynamic exchange rates

## Timeline Estimate

| PR | Complexity | Est. Time | Cumulative |
|----|-----------|-----------|------------|
| #3 | Low | 30 min | 30 min |
| #4 | Medium | 2 hours | 2h 30m |
| #5 | High | 3 hours | 5h 30m |
| #6 | Medium | 2 hours | 7h 30m |
| #7 | High | 3 hours | 10h 30m |

**Total**: ~10.5 hours (1.5 dev days)

## Next Immediate Steps

1. **Verify 1ai-payment service is running**:
   ```bash
   curl http://localhost:3100/health
   # Expected: {"status":"ok"}
   ```

2. **Generate API key** (if not exists):
   ```bash
   cd ~/projects/1ai-payment
   npm run cli -- generate-api-key
   ```

3. **Start PR #3**: Install SDK package
   ```bash
   cd ~/projects/1ai-payment/packages/sdk
   npm pack
   cd ~/projects/1ai-tracker
   npm install ~/projects/1ai-payment/packages/sdk/1ai-payment-sdk-1.0.0.tgz
   ```

## Questions to Resolve

1. **Gateway Selection Logic**: Should we expose gateway selection to users, or auto-select based on currency/region?
   - **Recommendation**: Auto-select for MVP (IDR→midtrans, USD→stripe), expose as dropdown in future

2. **Webhook Retry Policy**: How many times should we retry failed subscription activation?
   - **Recommendation**: 3 retries with exponential backoff (1s, 2s, 4s), then alert admin

3. **Test vs Prod API Keys**: Should we have separate keys for dev/staging/prod?
   - **Recommendation**: Yes — use `ONEAI_PAYMENT_API_KEY_DEV` for local, rotate prod keys quarterly

4. **Backward Compatibility**: Should old Stripe checkout sessions still work during migration?
   - **Recommendation**: No — clean cutover after PR #4, no parallel systems

---

**Created**: 2026-07-09  
**Author**: AI Agent (1ai-tracker integration)  
**Status**: ✅ READY TO EXECUTE
