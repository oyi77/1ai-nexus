// Shared event bus contract.
// Implementations: RedisStreamsBus and MemoryBus.

export interface TraceMeta {
  traceId: string;
  spanId: string;
}

export interface EventEnvelope<T = unknown> {
  stream: string;
  eventId: string;
  schemaVersion: string;
  occurredAt: Date;
  key?: string;
  payload: T;
  trace?: TraceMeta;
}

export interface IEventBus {
  publish<T>(envelope: EventEnvelope<T>): Promise<void>;
  subscribe<T>(
    stream: string,
    handler: (envelope: EventEnvelope<T>) => Promise<void>,
    opts: { consumerGroup?: string; consumer?: string },
  ): Promise<void>;
}
