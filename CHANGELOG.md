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
