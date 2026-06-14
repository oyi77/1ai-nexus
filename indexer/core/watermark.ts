// ─────────────────────────────────────────────────────────────
// WatermarkStore — durable per-chain sync checkpoint
// Replaces ad-hoc upsert in chain listeners with one source-of-truth
// ─────────────────────────────────────────────────────────────
import { prisma } from "../db";

export interface ChainWatermark {
  chain: string;
  lastBlock: bigint;
  lastTxHash: string | null;
  updatedAt: Date;
}

export class WatermarkStore {
  constructor(private readonly prismaClient = prisma) {}

  async get(chain: string): Promise<ChainWatermark | null> {
    const row = await this.prismaClient.indexerCheckpoint.findUnique({
      where: { chain },
    });
    if (!row) return null;
    return {
      chain: row.chain,
      lastBlock: row.lastBlock,
      lastTxHash: row.lastTxHash ?? null,
      updatedAt: row.updatedAt,
    };
  }

  async update(
    chain: string,
    block: bigint,
    txHash?: string,
  ): Promise<ChainWatermark> {
    const now = new Date();
    const saved = await this.prismaClient.indexerCheckpoint.upsert({
      where: { chain },
      update: {
        lastBlock: block,
        lastTxHash: txHash ?? undefined,
        updatedAt: now,
      },
      create: {
        chain,
        lastBlock: block,
        lastTxHash: txHash ?? null,
      },
    });
    return {
      chain: saved.chain,
      lastBlock: saved.lastBlock,
      lastTxHash: saved.lastTxHash ?? null,
      updatedAt: saved.updatedAt,
    };
  }

  async getLag(chain: string, headBlock: bigint): Promise<bigint> {
    const wm = await this.get(chain);
    if (!wm) return headBlock;
    return headBlock - wm.lastBlock;
  }
}

export const watermarkStore = new WatermarkStore();
