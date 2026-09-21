"""Refresh SECTOR_PERSIST in src/lib/modules/derived/insight-brief.ts.
Run: python3 scripts/measure-sector-persistence.py (<10s) then paste cells.
"""
"""Sector-rotation flow-persistence backtest: do today's flow extremes persist?

Event: one day's top-3 inflow sectors + bottom-3 outflow sectors
(identical selection to insight-brief.ts sectorRotation: newest-day
aggregate, HAVING sum<>0, order by net DESC, top3 + bottom3 ex-overlap).
Outcome: next calendar day with data — same sector present in the same
directional third (top-3 inflow again for winners, bottom-3 outflow again
for losers). Sample = per-sector-leg appearances across day pairs.
"""
import json
import psycopg2

c = psycopg2.connect('dbname=nexus user=postgres password=postgres host=localhost')
c.autocommit = True
cur = c.cursor()
cur.execute("SET statement_timeout='590s'")

cur.execute('''
WITH daily AS (
  SELECT timestamp::date AS d, sector,
         SUM("netSmartMoneyFlowUsd")::float AS net
  FROM "SectorFlowSnapshot"
  GROUP BY 1, 2
  HAVING sum("netSmartMoneyFlowUsd") <> 0
),
ranked AS (
  SELECT d, sector, net,
    row_number() OVER (PARTITION BY d ORDER BY net DESC) AS r_desc,
    row_number() OVER (PARTITION BY d ORDER BY net ASC) AS r_asc,
    count(*) OVER (PARTITION BY d) AS nday
  FROM daily
),
legs AS (
  SELECT d, sector,
    CASE WHEN r_desc <= 3 THEN 'top' ELSE 'bottom' END AS side
  FROM ranked
  WHERE nday >= 4 AND (
    r_desc <= 3 OR (r_asc <= 3 AND r_desc > 3)
  )
),
pairs AS (
  SELECT a.d AS d0, b.d AS d1, a.sector, a.side,
    (a.side = 'top' AND b.side = 'top') OR
    (a.side = 'bottom' AND b.side = 'bottom') AS persisted
  FROM legs a
  JOIN legs b ON b.sector = a.sector
    AND b.d = (SELECT min(d) FROM legs WHERE d > a.d AND sector = a.sector
               AND d <= a.d + interval '3 days')
)
SELECT side, count(*) AS n,
  sum(CASE WHEN persisted THEN 1 ELSE 0 END) AS hits
FROM pairs
GROUP BY 1
''')
out = {r[0]: {'n': r[1], 'hits': int(r[2]),
              'rate': round(int(r[2]) / r[1] * 100, 2)} for r in cur.fetchall()}
out['asOf'] = '2026-09-21'
with open('/tmp/sector-edge.json', 'w') as f:
    json.dump(out, f, indent=1)
print(json.dumps(out, indent=1))
