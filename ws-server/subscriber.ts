import Redis from "ioredis";
import type { Server } from "socket.io";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const CHANNELS = [
  "nexus:trades",
  "nexus:alerts",
  "nexus:prices",
  "nexus:flows",
  "nexus:cex",
] as const;

const CHANNEL_TO_NAMESPACE: Record<string, string> = {
  "nexus:trades": "/trades",
  "nexus:alerts": "/alerts",
  "nexus:prices": "/prices",
  "nexus:flows": "/flows",
  "nexus:cex": "/cex",
};

export function startSubscriber(io: Server): Redis {
  const subscriber = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 10) return null;
      return Math.min(times * 200, 5000);
    },
  });

  subscriber.on("error", (err) => {
    console.error("[Subscriber] Redis error:", err.message);
  });

  subscriber.on("connect", () => {
    console.log("[Subscriber] Connected to Redis at", REDIS_URL);
  });

  subscriber.subscribe(...CHANNELS, (err, count) => {
    if (err) {
      console.error("[Subscriber] Failed to subscribe:", err);
      return;
    }
    console.log(`[Subscriber] Subscribed to ${count} channels`);
  });

  subscriber.on("message", (channel, message) => {
    const namespace = CHANNEL_TO_NAMESPACE[channel];
    if (!namespace) return;

    try {
      const event = JSON.parse(message);

      // Emit to the namespace (all connected clients in that namespace)
      io.of(namespace).emit("event", event);

      // Also emit to rooms matching the event data
      if (event.data?.platform) {
        const room = `${namespace}:${event.data.platform}`;
        io.of(namespace).to(room).emit("event", event);
      }
      if (event.data?.triggerType) {
        const room = `${namespace}:${event.data.triggerType}`;
        io.of(namespace).to(room).emit("event", event);
      }
    } catch (err) {
      console.error(
        `[Subscriber] Failed to process message on ${channel}:`,
        err
      );
    }
  });

  return subscriber;
}
