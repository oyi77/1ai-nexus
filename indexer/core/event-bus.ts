import Redis from "ioredis";

import { EventEnvelope, IEventBus } from "./event-contract";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export class RedisStreamsBus implements IEventBus {
  private client: Redis;
  private sub: Redis;

  constructor() {
    this.client = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    this.sub = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        return Math.min(times * 200, 5000);
      },
    });
  }

  async publish<T>(envelope: EventEnvelope<T>): Promise<void> {
    const stream = envelope.stream;
    await this.client.xadd(stream, "*", "eventId", envelope.eventId, "schemaVersion", envelope.schemaVersion, "occurredAt", envelope.occurredAt.toISOString(), "payload", JSON.stringify(envelope.payload));
  }

  async subscribe<T>(
    stream: string,
    handler: (envelope: EventEnvelope<T>) => Promise<void>,
    opts: { consumerGroup?: string; consumer?: string } = {},
  ): Promise<void> {
    const group = opts.consumerGroup ?? "idx";
    const consumer = opts.consumer ?? "worker-1";

    await this.client.xgroup("CREATE", stream, group, "0", "MKSTREAM").catch(() => {});

    const read = async () => {
      const res = await this.client.xreadgroup(
        "GROUP",
        group,
        consumer,
        "COUNT",
        "50",
        "BLOCK",
        "5000",
        "STREAMS",
        stream,
        ">",
      )

      if (!res) return;

      for (const [, [, ...entries]] of res) {
        for (const entry of entries) {
          const [id, ...kvs] = entry;
          const map = toMap(kvs);
          const envelope: EventEnvelope = {
            stream,
            eventId: map.eventId,
            schemaVersion: map.schemaVersion,
            occurredAt: new Date(map.occurredAt ?? Date.now()),
            payload: safeJson(map.payload),
          };
          await handler(envelope);
          await this.client.xack(stream, group, id);
        }
      }

      await read();
    };

    read().catch((e) => {
      console.error(`[stream:${stream}] reader crashed:`, e);
      setTimeout(() => subscribe(this, stream, handler, opts), 1000);
    });
  }
}

export function subscribe<T>(
  bus: IEventBus,
  stream: string,
  handler: (envelope: EventEnvelope<T>) => Promise<void>,
  opts: { consumerGroup?: string; consumer?: string }
) {
  return bus.subscribe(stream, handler, opts);
}

export const eventBus = new RedisStreamsBus();

function toMap(kvs: string[]): Record<string, string> { const out: Record<string, string> = {};
for (let i = 0; i < kvs.length; i += 2) out[kvs[i]] = kvs[i + 1];
return out; }

function safeJson(v: unknown) { try { return JSON.parse(v); } catch { return v; } }
