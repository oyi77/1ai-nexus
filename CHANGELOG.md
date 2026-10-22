# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-07-06

### Fixed
- **Price formatting**: Small decimal prices (e.g., 0.2345) no longer truncate to 2 decimals
  - Added `formatPriceUSD()` utility in `src/lib/format.ts` with adaptive decimal precision
  - Applied to `ai-signals/page.tsx` and `alpha-engine/page.tsx`
- **CSS loading**: Production Tailwind CSS not loading due to stale build
  - Rebuilt and restarted production service
- **Console.log cleanup**: Replaced console.log with structured logger in data-refresher and instrumentation
  - Created `src/lib/logger.ts` with leveled logging (debug/info/warn/error)
  - Updated `src/lib/data-refresher.ts` to use logger
  - Updated `src/instrumentation.ts` to use logger
  - Updated `src/app/api/v1/webhooks/[gateway]/route.ts` to use logger
- **Dev-history verdict fabricated migration failures**: `assessDevHistory` counted every deployed token as a failed migration, so a developer with three tokens younger than a day was rejected as `SERIAL_RUGGER` ("3 prior tokens deployed and 0 ever migrated") — token EVOLVE was 24 minutes old. Immature tokens (`createdAtAgeSeconds < matureMinAgeSeconds`, default 3600s) are now excluded from both the migration rate and the zero-migration rule; a migrated token still counts at any age. A token whose `migrated` field upstream never reported is now `null` (tri-state) and excluded from the judged sample (`knownMigrations`) instead of being read as "did not migrate", and `0` judged tokens returns UNPROVEN instead of falling through to CLEAN. The verdict exposes `matureTokens` and `knownMigrations` so every reason names the sample it was earned on. Verified live against `EdNSCBBx…pump`: previously SERIAL_RUGGER on 3 tokens, now `SUSPECT` on 2 mature known outcomes out of 3 total

### Added
- **Tests**: Added comprehensive tests for `format.ts` utility (15 tests)
- **Logger**: Created structured logger module (`src/lib/logger.ts`)
- **Financial disclaimer**: Integrated disclaimer component into AI signals page
  - Closes #16 (Disclaimer Component)
  - Closes #17 (Financial Advice Warning)

### Changed
- **Issue cleanup**: Closed 9 open issues that were already implemented
  - #2 Derivatives Intelligence
  - #3 Attention Index
  - #4 Stablecoin Intelligence
  - #5 Infrastructure Signals
  - #12 API Authentication
  - #13 Rate Limiting
  - #14 Usage Tracking
  - #16 Disclaimer Component
  - #17 Financial Advice Warning

### Technical
- Fixed `formatPrice()` to not include `$` prefix (use `formatPriceUSD()` for prefix)
- Resolved TODO in webhook route with descriptive comment
- Build passing, 20/21 test files passing (1 pre-existing failure)
