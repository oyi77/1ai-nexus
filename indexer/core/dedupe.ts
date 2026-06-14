// ─────────────────────────────────────────────────────────────
// DedupeGate — Redis-backed seen-set for txs/events
// Uses SET NX with TTL 24h
// ─────────────────────────────────────────────────────────────
import { redis } from "../publisher";

export class DedupeGate {
  private prefix: string;

  constructor(prefix = "idx") {
    this.prefix = prefix;
  }

  private key(chain: string, id: string): string {
    return `${this.prefix}:seen:${chain}:${id}`;
  }

  async seen(chain: string, id: string): Promise<boolean> {
    const k = this.key(chain, id);
    const exists = await redis.exists(k);
    if (exists) return true;
    // mark with expir
    await redis.set(k, "1", "EX", 86_400);
    return false;
  }

  async seenMany(
    chain: string,
    ids: string[],
  ): Promise<{ newIds: string[]; dupIds: string[] }> {
    const pipe = redis.pipeline();
    for (const id of ids) {
      pipe.setnx(this.key(chain, id), "1");
    }
    // TTL in bulk (best-effort; ioredis supports multi exec)
    for (const id of ids) {
      pipe.expire(this.key(chain, id), 86_400);
    }
    const results = (await pipe.exec()) as unknown[];
    const flags = results.filter((_, i) => i < ids.length) as boolean[];
    const newIds: string[] = [];
    const dupIds: string[] = [];
    ids.forEach((id, i) => (flags[i] ? newIds.push(id) : dupIds.push(id)));
    return { newIds, dupIds };
  }
}

export const dedupeGate = new DedupeGate("idx");
