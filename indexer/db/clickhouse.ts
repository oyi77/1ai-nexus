// ─────────────────────────────────────────────────────────────
// ClickHouse client wrapper with connection pooling and retry
// ─────────────────────────────────────────────────────────────
import { createClient } from "@clickhouse/client";

const url = process.env.CLICKHOUSE_URL || "http://localhost:8123";
const user = process.env.CLICKHOUSE_USER || "default";
const password = process.env.CLICKHOUSE_PASSWORD || "";

export const clickhouse = createClient({
  url,
  username: user,
  password,
  request_timeout: 10_000,
  keep_alive: { enabled: true, idle_timeout_ms: 60_000 },
  pool: { min: 1, max: 4 },
});

export async function clickhouseQuery<T = any>(sql: string, params?: Record<string, any>): Promise<T[]> {
  const resultSet = await clickhouse.query({ query: sql, format: "JSONEachRow", query_params: params });
  const rows: T[] = [];
  for await (const row of resultSet) {
    rows.push(row as T);
  }
  return rows;
}

export async function clickhouseInsert(table: string, rows: Record<string, any>[]): Promise<void> {
  if (rows.length === 0) return;
  await clickhouse.insert({
    table,
    format: "JSONEachRow",
    values: rows,
  });
}

export async function pingClickHouse(): Promise<boolean> {
  try {
    await clickhouse.query({ query: "SELECT 1", format: "TabSeparated" });
    return true;
  } catch (e) {
    return false;
  }
}
