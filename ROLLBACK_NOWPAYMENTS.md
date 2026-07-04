# NOWPayments Migration Rollback Plan

## Migration Summary
- **Date**: 2026-07-04
- **Component**: 1ai-tracker NOWPayments provider
- **Change**: Migrated from direct NOWPayments SDK calls to 1ai-payment adapter
- **Status**: Complete, tested, and verified

## What Changed
1. **File Modified**: `src/lib/payments/nowpayments.ts`
   - Replaced direct NOWPayments API calls with 1ai-payment adapter
   - Same function signatures maintained (backward compatible)
   - Added `OneAiPaymentClient` for HTTP marshaling
   - Added proper TypeScript types and validation

2. **File Added**: `tests/nowpayments.test.ts`
   - 14 comprehensive unit tests covering all scenarios
   - All tests passing (14/14)

## Rollback Procedure

### If Issues Occur
1. Stop 1ai-tracker application
2. Revert the migration commit:
   ```bash
   cd /home/openclaw/projects/1ai-tracker
   git revert <commit-hash>
   npm install
   npm run build
   npm start
   ```

### Quick Rollback to Original
1. Restore original NOWPayments provider:
   ```bash
   git checkout HEAD~1 src/lib/payments/nowpayments.ts
   ```

2. Rebuild and restart:
   ```bash
   npm run build
   npm start
   ```

## Verification Steps After Rollback
1. Check TypeScript compilation: `npm run build`
2. Run tests: `npm test`
3. Verify webhook handler works: Check logs in `/api/v1/webhooks/nowpayments`
4. Test payment creation via direct SDK

## Dependencies & Prerequisites
- 1ai-payment must be running at `http://localhost:3100`
- 1ai-payment API key: `test-key` (for dev) or configured via `ONE_AI_PAYMENT_KEY` env var
- NOWPayments credentials still required for webhook signature verification

## Environment Variables
- `ONE_AI_PAYMENT_URL` (default: `http://localhost:3100/api`)
- `ONE_AI_PAYMENT_KEY` (default: `dev-key-1ai-tracker`)
- `NOWPAYMENTS_IPN_SECRET` (required for webhook verification)
- `CALLBACK_URL` (default: `http://localhost:3000`)

## Testing After Rollback
```bash
# Run full test suite
npm test

# Run only NOWPayments tests
npm test -- tests/nowpayments.test.ts

# Build verification
npm run build
```

## Support
- Check 1ai-payment logs: `tail -f /tmp/1ai-payment.log`
- Verify adapter is working: `curl http://localhost:3100/api/gateways -H "x-api-key: test-key"`
- NOWPayments API docs: https://documenter.getpostman.com/view/8182628

## Commit Information
- Commit Message: `feat: migrate 1ai-tracker NOWPayments to 1ai-payment adapter`
- Files Changed: 2 (1 modified, 1 added)
- Tests: 14 passing
- Build Status: ✓ Success
