import Redis from "ioredis";
import type { Server } from "socket.io";
import { RedisStreamsBus } from "../indexer/streams/redis-streams";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const LEGACY_CHANNELS = [
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
  "stream:nexus:trades": "/trades",
  "stream:nexus:alerts": "/alerts",
  "stream:nexus:prices": "/prices",
  "stream:nexus:flows": "/flows",
  "stream:nexus:cex": "/cex",
};

interface StreamEvent {
  data?: {
    platform?: string;
    triggerType?: string;
  };
}

export function startSubscriber(io: Server): { legacy: Redis; streams: RedisStreamsBus } {
  // Legacy pub/sub bridge
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

  subscriber.subscribe(...LEGACY_CHANNELS, (err, count) => {
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
      const streamEvent = event as StreamEvent;

      // Emit to the namespace (all connected clients in that namespace)
      io.of(namespace).emit("event", event);

      // Also emit to rooms matching the event data
      if (streamEvent.data?.platform) {
        const room = `${namespace}:${streamEvent.data.platform}`;
        io.of(namespace).to(room).emit("event", event);
      }
      if (streamEvent.data?.triggerType) {
        const room = `${namespace}:${streamEvent.data.triggerType}`;
        io.of(namespace).to(room).emit("event", event);
      }
    } catch (err) {
      console.error(
        `[Subscriber] Failed to process message on ${channel}:`,
        err
      );
    }
  });

  // Redis Streams bridge (consumes enriched tx bus events)
  const streams = new RedisStreamsBus();
  void streams.subscribe(
    "stream:nexus:trades",
    async (envelope) => {
      try {
        io.of("/trades").emit("event", envelope.payload);
      } catch (err) {
        console.error("[Subscriber] Stream emit failed:", err);
      }
    },
    { consumerGroup: "ws-server", consumer: "ws-1" }
  );

  return { legacy: subscriber, streams };
}
