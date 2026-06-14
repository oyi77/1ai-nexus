// ─────────────────────────────────────────────────────────────
// EVM Batch Indexer — replaces 1-ws-per-wallet with batched log filter
// Watermark-backed resume, 2000-addr batch, dedupe before publish
// ─────────────────────────────────────────────────────────────
import WebSocket from "ws";
import { prisma } from "../db";
import { publishEvent } from "../publisher";
import { watermarkStore } from "./watermark";
import { dedupeGate } from "./dedupe";

type Chain = "eth" | "arb" | "base" | "op";

const PUBLIC_WS_URLS: Record<Chain, string> = {
  eth: process.env.ETH_WS_URL || "wss://ethereum-rpc.publicnode.com",
  arb: process.env.ARB_WS_URL || "wss://arbitrum-one-rpc.publicnode.com",
  base: process.env.BASE_WS_URL || "wss://base-rpc.publicnode.com",
  op: process.env.OP_WS_URL || "wss://optimism-rpc.publicnode.com",
};

const ADDRESS_BATCH = 1500; // per WS subscription
const RECONNECT_MS = 3000;

export async function startEthereumBatchIndexer(): Promise<void> {
  for (const chain of ["eth", "arb", "base", "op"] as Chain[]) {
    void connectChain(chain);
  }
}

async function addressBatch(chain: string): Promise<string[]> {
  const rows = await prisma.wallet.findMany({
    where: { chain },
    select: { address: true },
  });
  return rows.map((r) => r.address.toLowerCase());
}

async function blockBackfillIfGap(chain: Chain): Promise<void> {
  const wm = await watermarkStore.get(chain);
  if (!wm || wm.lastBlock === 0n) return;
  const gap = await watermarkStore.getLag(chain, await headBlock(chain));
  if (gap <= 5n) return;
  // Mark that backfill should run; real backfill goes to separate worker.
  // For now: just log to avoid hot loop on every HEADS update.
  console.log(`[eth-batch:${chain}] backfill gap=${gap.toString()} blocks (deferred to worker)`);
}

async function headBlock(chain: Chain): Promise<bigint> {
  const url = PUBLIC_WS_URLS[chain];
  // Use the WS to read current block number
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("head timeout"));
    }, 8_000);
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: ["newHeads"],
        })
      );
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.method === "eth_subscription" && msg.params?.result?.number) {
          clearTimeout(timer);
          ws.close();
          resolve(BigInt(parseInt(msg.params.result.number, 16)));
        }
      });
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      ws.close();
      reject(err);
    });
  });
}

function connectChain(chain: Chain) {
  const url = PUBLIC_WS_URLS[chain];
  console.log(`[eth-batch:${chain}] connecting to ${url}...`);

  const ws = new WebSocket(url);
  ws.on("open", async () => {
    console.log(`[eth-batch:${chain}] connected`);

    // Always track block heads
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_subscribe",
        params: ["newHeads"],
      })
    );

    // Batched wallet log filter
    const addrs = await addressBatch(chain);
    console.log(`[eth-batch:${chain}] tracked addrs=${addrs.length}`);
    if (addrs.length > 0) {
      for (let i = 0; i < addrs.length; i += ADDRESS_BATCH) {
        const chunk = addrs.slice(i, i + ADDRESS_BATCH);
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2 + i,
            method: "eth_subscribe",
            params: ["logs", { address: chunk }],
          })
        );
      }
    }

    // Resume gap check
    await blockBackfillIfGap(chain);
  });

  ws.on("message", async (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method !== "eth_subscription") return;

      if (msg.params?.result?.number) {
        const bn = BigInt(parseInt(msg.params.result.number, 16));
        await watermarkStore.update(chain, bn).catch((e) =>
          console.error(`[eth-batch:${chain}] watermark error:`, e.message),
        );
        return;
      }

      // Log / tx-related event
      const log = msg.params?.result;
      if (!log?.transactionHash) return;
      const txHash = log.transactionHash.toLowerCase();

      if (await dedupeGate.seen(chain, txHash)) return;

      await publishEvent("nexus:trades", {
        chain,
        hash: txHash,
        from: log.address,
        to: log.address,
        transactionHash: txHash,
        topics: log.topics,
        data: log.data,
        blockNumber: log.blockNumber,
        ingestedAt: new Date().toISOString(),
      }).catch((e) =>
        console.error(`[eth-batch:${chain}] publish error:`, e.message),
      );
    } catch (e) {
      console.error(`[eth-batch:${chain}] message error:`, e);
    }
  });

  ws.on("close", () => {
    console.log(`[eth-batch:${chain}] disconnected, reconnecting in ${RECONNECT_MS}ms...`);
    setTimeout(() => connectChain(chain), RECONNECT_MS);
  });

  ws.on("error", (err) => {
    console.error(`[eth-batch:${chain}] error:`, err.message);
  });
}
