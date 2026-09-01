-- Composite indexes for evaluateTrackRecord + getTrackAccuracy
-- evaluateTrackRecord: WHERE emittedAt < cutoff AND price IS NOT NULL AND outcome IS NULL
CREATE INDEX "ConvictionSignal_emittedAt_outcome_idx" ON "ConvictionSignal"("emittedAt", "outcome");
-- getTrackAccuracy: WHERE market = ? AND outcome IS NOT NULL GROUP BY conviction
CREATE INDEX "ConvictionSignal_market_outcome_conviction_idx" ON "ConvictionSignal"("market", "outcome", "conviction");
