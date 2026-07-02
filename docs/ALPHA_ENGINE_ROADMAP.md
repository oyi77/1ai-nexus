# Alpha Engine Sellable Roadmap

## Overview
Make the alpha engine production-ready for sale as a signal intelligence service.

## Issues Created (15 total)

### Phase 1: Foundation (HIGH priority)
| Issue | Title | PR | Status |
|-------|-------|-----|--------|
| #6 | Backtest Engine | PR1 | ⏳ Pending |
| #7 | Signal Outcome Tracking | PR2 | ⏳ Pending |
| #8 | Win Rate Calculator | PR3 | ⏳ Pending |

### Phase 2: Risk Management (MEDIUM priority)
| Issue | Title | PR | Status |
|-------|-------|-----|--------|
| #9 | Position Sizing Calculator | PR4 | ⏳ Pending |
| #10 | Max Drawdown Protection | PR5 | ⏳ Pending |
| #11 | Risk/Reward Ratio Display | PR6 | ⏳ Pending |

### Phase 3: API Hardening (HIGH priority)
| Issue | Title | PR | Status |
|-------|-------|-----|--------|
| #12 | API Authentication | PR7 | ⏳ Pending |
| #13 | Rate Limiting Per Tier | PR8 | ⏳ Pending |
| #14 | Usage Tracking | PR9 | ⏳ Pending |

### Phase 4: Compliance (HIGH priority)
| Issue | Title | PR | Status |
|-------|-------|-----|--------|
| #15 | Terms of Service | PR10 | ⏳ Pending |
| #16 | Disclaimer Component | PR11 | ⏳ Pending |
| #17 | Financial Advice Warning | PR12 | ⏳ Pending |

### Phase 5: Monetization (MEDIUM priority)
| Issue | Title | PR | Status |
|-------|-------|-----|--------|
| #18 | Pricing Tiers UI | PR13 | ⏳ Pending |
| #19 | Stripe Integration | PR14 | ⏳ Pending |
| #20 | Subscription Management | PR15 | ⏳ Pending |

## PR Process

### 1. Create Branch
```bash
git checkout -b feat/issue-N-title
```

### 2. Implement
- Follow 1ai-rules GATE checklist
- Write tests
- Update documentation

### 3. Create PR
```bash
gh pr create --title "feat: Title" --body "Closes #N"
```

### 4. Fresh-Agent Review
Each PR MUST be reviewed by a fresh agent (no context of implementation) to prevent bias:
- Agent reads only the diff + spec
- Checks for: correctness, security, performance, edge cases
- Verifies acceptance criteria met
- Provides verdict: APPROVED / CHANGES REQUESTED / BLOCK

### 5. Merge
After fresh-agent APPROVED:
```bash
gh pr merge --squash
```

## Timeline Estimate

| Phase | Issues | Est. Time | Dependencies |
|-------|--------|-----------|--------------|
| Foundation | 3 | 2-3 days | None |
| Risk Management | 3 | 1-2 days | Phase 1 |
| API Hardening | 3 | 2-3 days | None |
| Compliance | 3 | 1 day | None |
| Monetization | 3 | 2-3 days | Phase 3 |
| **Total** | **15** | **8-12 days** | |

## Success Criteria

- [ ] Backtest proves >55% win rate
- [ ] All signals have Entry/TP/SL
- [ ] API authentication working
- [ ] Rate limiting enforced
- [ ] ToS and disclaimers in place
- [ ] Stripe payments working
- [ ] Fresh-agent review passed for all PRs

## Next Steps

1. Start with Issue #6 (Backtest Engine) - highest priority
2. Create PR with fresh-agent review
3. Merge and move to next issue
4. Repeat until all 15 issues complete
