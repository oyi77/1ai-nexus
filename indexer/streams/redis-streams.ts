import Redis from "ioredis";
import { EventEnvelope, IEventBus } from "./event-contract";

export class RedisStreamsBus implements IEventBus {
  private subscriber: Redis;

  constructor(private readonly client: Redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null })) {
    this.subscriber = new Redis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
  }

  async publish<T>(envelope: EventEnvelope<T>): Promise<void> {
    await this.client.xadd(
      envelope.stream,
      "*",
      "eventId",
      envelope.eventId,
      "timestamp",
      new Date(envelope.occurredAt).getTime().toString(),
      "payload",
      JSON.stringify(envelope)
    );
  }

  async subscribe<T>(stream: string, onMessage: (envelope: EventEnvelope<T>) => Promise<void>): Promise<void> {
    await this.client.xgroup("CREATE", stream, "tracker", "0", "MKSTREAM").catch(() => {});

    const loop = async () => {
      const res = await this.client.xreadgroup(
        "GROUP",
        "tracker",
        "worker",
        "COUNT",
        "50",
        "BLOCK",
        "5000",
        "STREAMS",
        stream,
        ">"
      );

      if (!res) {
        setTimeout(loop, 500);
        return;
      }

      for (const [, [, ...entries]] of res) {
        for (const entry of entries) {
          const [id, ...kvs] = entry;
          const envelope: EventEnvelope = JSON.parse(kvs[1]);
          await onMessage(envelope);
          await this.client.xack(stream, "tracker", id);
        }
      }

      setTimeout(loop, 100);
    };

    loop();
  }
}
