"""Refresh FUNDING_UNWIND_CELLS in src/lib/modules/derived/insight-brief.ts.
Run: python3 scripts/measure-funding-unwind.py (~3 min) then paste cells.
"""
"""Funding-crowding unwind backtest: pooled hit rate of contrarian direction.

Event: hourly bar with trailing-7d funding z (|z|>=tier, |z|<60), side keyed
off RATE sign exactly like insight-brief.ts fundingExtremes (rate>0 =
crowded longs -> unwind bearish; rate<0 = crowded shorts -> unwind bullish).
Episode-deduped: only the first hour of a contiguous extreme run counts.
Outcome: 24h forward markPrice return sign == unwind direction.
"""
import json
import psycopg2

c = psycopg2.connect('dbname=nexus user=postgres password=postgres host=localhost')
c.autocommit = True
cur = c.cursor()
cur.execute("SET statement_timeout='590s'")

cur.execute('''
WITH hourly AS (
  SELECT exchange, symbol, date_trunc('hour', timestamp) AS h,
    (array_agg("fundingRate" ORDER BY timestamp DESC))[1]::float AS rate,
    (array_agg("markPrice" ORDER BY timestamp DESC)
      FILTER (WHERE "markPrice" IS NOT NULL AND "markPrice" > 0))[1]::float AS px
  FROM "DerivativesSnapshot"
  GROUP BY 1, 2, 3
),
stat AS (
  SELECT exchange, symbol, h, rate, px,
    avg(rate) OVER w AS mean,
    stddev_samp(rate) OVER w AS sd,
    count(*) OVER w AS n,
    lead(px, 24) OVER p AS px_fwd,
    lead(h, 24) OVER p AS h_fwd
  FROM hourly
  WINDOW
    w AS (PARTITION BY exchange, symbol ORDER BY h
          RANGE BETWEEN interval '7 days' PRECEDING AND interval '1 hour' PRECEDING),
    p AS (PARTITION BY exchange, symbol ORDER BY h)
),
z AS (
  SELECT exchange, symbol, h, rate, px, px_fwd, h_fwd, n,
    (rate - mean) / NULLIF(sd, 0) AS z
  FROM stat
),
ep AS (
  SELECT exchange, symbol, h, rate, px, px_fwd, h_fwd, n, z,
    lag(z) OVER p AS z_prev,
    lag(rate) OVER p AS rate_prev,
    lag(h) OVER p AS h_prev
  FROM z
  WINDOW p AS (PARTITION BY exchange, symbol ORDER BY h)
),
ev AS (
  SELECT exchange, symbol, h, rate, px, px_fwd,
    abs(z) AS az,
    CASE WHEN rate > 0 THEN 'long' WHEN rate < 0 THEN 'short' ELSE 'flat' END AS side,
    CASE WHEN abs(z) >= 5 THEN 5 WHEN abs(z) >= 3 THEN 3 ELSE 2 END AS tier,
    px_fwd / NULLIF(px, 0) - 1 AS fwdret
  FROM ep
  WHERE n >= 100 AND abs(z) >= 2 AND abs(z) < 60
    AND rate <> 0 AND px > 0 AND px_fwd > 0
    AND h_fwd = h + interval '24 hours'
    AND (h_prev IS NULL OR h_prev <> h - interval '1 hour'
         OR abs(z_prev) < 2 OR sign(rate_prev) <> sign(rate))
)
SELECT exchange, side, tier, count(*) AS n,
  sum(CASE WHEN (side = 'long' AND fwdret < 0)
             OR (side = 'short' AND fwdret > 0) THEN 1 ELSE 0 END) AS hits,
  avg(fwdret)::float AS avg_fwdret
FROM ev
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
''')

out = [
    {'exchange': r[0], 'side': r[1], 'tier': r[2], 'n': r[3],
     'hits': int(r[4]), 'hit_rate': round(int(r[4]) / r[3] * 100, 2),
     'avg_fwdret_pct': round(r[5] * 100, 3)}
    for r in cur.fetchall()
]
with open('/tmp/funding-edge.json', 'w') as f:
    json.dump(out, f, indent=1)
print(json.dumps(out, indent=1))
