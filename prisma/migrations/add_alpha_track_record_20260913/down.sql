-- Rollback: drop the AlphaTrackRecord baseline (fresh-DB path only).
-- On live DB this table holds real history — do NOT roll back there.
DROP TABLE IF EXISTS "AlphaTrackRecord";
