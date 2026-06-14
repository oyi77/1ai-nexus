import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const eventClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times: number) {
    return Math.min(times * 200, 5000);
  },
});

export async function publishEvent(channel: string, payload: Record<string, unknown>): Promise<void> {
  // Mirror to legacy channel + new stream (dual-write during migration)
  await eventClient.publish(channel, JSON.stringify(payload));
  await eventClient.xadd(
    `stream:${channel}`,
    "*",
    "payload",
    JSON.stringify(payload),
    "ts",
    new Date().toISOString(),
  );
}

export async function subscribeLegacy(channel: string, handler: (message: string) => Promise<void>): Promise<Redis> {
  const subscriber = new Redis(REDIS_URL);
  subscriber.subscribe(channel, (err) => {
    if (err) console.error("[event] subscribe failed:", err);
  });
  subscriber.on("message", (_ch, msg) => handler(msg));
  return subscriber;
}
