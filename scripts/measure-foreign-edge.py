"""Refresh FOREIGN_EDGE in src/lib/modules/derived/insight-brief.ts.
Run: python3 scripts/measure-foreign-edge.py (<5s) then paste cells.
NOTE: also refresh the broad-sign query (inline in session notes).
"""
"""Foreign-flow direct edge: does daily foreign net predict next-session return?

Per stock-day: foreign_net = foreignBuy - foreignSell.
Signal: cross-sectional rank of foreign_net within the day (deciles).
Outcome: next traded session's close-to-close return for the same code.
Metric: mean next-day return of top-decile (accumulation) vs bottom-decile
(distribution), plus rank IC across all stocks per day.
"""
import json
import psycopg2
from collections import defaultdict

c = psycopg2.connect('dbname=nexus user=postgres password=postgres host=localhost')
c.autocommit = True
cur = c.cursor()
cur.execute("SET statement_timeout='590s'")

cur.execute('''
WITH s AS (
  SELECT code, "tradeDate" AS d, close,
         ("foreignBuy" - "foreignSell")::float AS fnet
  FROM "IdxSahamSession"
  WHERE close > 0
),
nxt AS (
  SELECT code, d, close, fnet,
    lead(close) OVER (PARTITION BY code ORDER BY d) AS close_next,
    lead(d) OVER (PARTITION BY code ORDER BY d) AS d_next
  FROM s
)
SELECT d, code, fnet, close_next / NULLIF(close, 0) - 1 AS fwdret
FROM nxt
WHERE close_next IS NOT NULL AND close_next > 0
''')
rows = cur.fetchall()
print('rows', len(rows))

by_day = defaultdict(list)
for d, code, fnet, fwdret in rows:
    by_day[d].append((code, fnet, fwdret))

top_rets, bot_rets, ics = [], [], []
for d, lst in sorted(by_day.items()):
    if len(lst) < 50:
        continue
    ranked = sorted(lst, key=lambda r: r[1])
    n = len(ranked)
    q = max(1, n // 10)
    bot = ranked[:q]
    top = ranked[-q:]
    top_rets.extend(r[2] for r in top)
    bot_rets.extend(r[2] for r in bot)
    # rank IC: spearman approx via rank corr
    xs = [r[1] for r in lst]
    ys = [r[2] for r in lst]
    rx = sorted(range(n), key=lambda i: xs[i])
    ry = sorted(range(n), key=lambda i: ys[i])
    pos_x = [0] * n
    pos_y = [0] * n
    for p, i in enumerate(rx):
        pos_x[i] = p
    for p, i in enumerate(ry):
        pos_y[i] = p
    mx = sum(pos_x) / n
    my = sum(pos_y) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(pos_x, pos_y))
    vx = sum((a - mx) ** 2 for a in pos_x)
    vy = sum((b - my) ** 2 for b in pos_y)
    if vx > 0 and vy > 0:
        import math
        ics.append(cov / math.sqrt(vx * vy))

def mean(xs):
    return sum(xs) / len(xs) if xs else None

out = {
    'days': len(by_day),
    'top_decile': {'n': len(top_rets), 'mean_fwdret_pct': round(mean(top_rets) * 100, 4) if top_rets else None},
    'bottom_decile': {'n': len(bot_rets), 'mean_fwdret_pct': round(mean(bot_rets) * 100, 4) if bot_rets else None},
    'spread_pp': round((mean(top_rets) - mean(bot_rets)) * 100, 4) if top_rets and bot_rets else None,
    'rankIC': {'n_days': len(ics), 'mean': round(sum(ics) / len(ics), 4) if ics else None},
    'asOf': '2026-09-22',
}
with open('/tmp/foreign-edge.json', 'w') as f:
    json.dump(out, f, indent=1)
print(json.dumps(out, indent=1))
