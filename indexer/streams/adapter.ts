import Redis from "ioredis";
import { EventEnvelope } from "../core/event-contract";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const STREAMS = [
  "stream:nexus:trades",
  "stream:nexus:alerts",
  "stream:nexus:prices",
  "stream:nexus:flows",
  "stream:nexus:cex",
];

export async function startStreamsAdapter(): Promise<Redis> {
  const sub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  for (const s of STREAMS) {
    await sub.xgroup("CREATE", s, "tracker", "0", "MKSTREAM").catch(() => {});
  }

  const pump = async () => {
    for (const s of STREAMS) {
      try {
        const res = await sub.xreadgroup(
          "GROUP",
          "tracker",
          "main",
          "COUNT",
          "25",
          "BLOCK",
          "2000",
          "STREAMS",
          s,
          ">",
        );
        if (!res) continue;
        for (const [, entries] of res) {
          for (const entry of entries) {
            const [id, ...kvs] = entry;
            const payload = kvs.find((v: any, i: number) => i % 2 === 1);
            if (!payload) continue;
            try {
              const env = JSON.parse(payload as string) as EventEnvelope;
              await sub.publish(s.replace("stream:", "legacy:"), JSON.stringify(env.payload));
              await sub.xack(s, "tracker", id);
            } catch {}
          }
        }
      } catch {}
    }
    setTimeout(pump, 5);
  };

  pump();
  return sub;
}
