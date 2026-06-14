import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
});

redis.on("connect", () => {
  console.log("[redis] connected");
});

redis.on("error", (err) => {
  console.error("[redis] error:", err.message);
});

export async function publishEvent(channel: string, payload: Record<string, unknown>) {
  const message = JSON.stringify(payload);
  await redis.publish(channel, message);

  // Write to Redis Streams for durable replay of enriched tx bus events
  try {
    await redis.xadd(
      `stream:${channel}`,
      "*",
      "eventId",
      `${Date.now()}:${Math.random()}`,
      "schemaVersion",
      "tx.v2",
      "payload",
      message,
    );
  } catch (streamErr) {
    // Best-effort secondary write
    console.error("[publisher] stream write failed", (streamErr as Error).message);
  }
}
