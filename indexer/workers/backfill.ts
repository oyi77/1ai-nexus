// ─────────────────────────────────────────────────────────────
// Backfill Worker — catches up missed chain data on startup / on-demand
// Uses existing IndexerCheckpoint; scans blocks using eth_getLogs
// Designed as one-shot + reentrant worker
// ─────────────────────────────────────────────────────────────
import WebSocket from "ws";
import { prisma } from "../db";
import { publishEvent } from "../publisher";
import { DedupeGate } from "../core/dedupe";

type Chain = "eth" | "arb" | "base" | "op";

const PUBLIC_WS_URLS: Record<Chain, string> = {
  eth: process.env.ETH_WS_URL || "wss://ethereum-rpc.publicnode.com",
  arb: process.env.ARB_WS_URL || "wss://arbitrum-one-rpc.publicnode.com",
  base: process.env.BASE_WS_URL || "wss://base-rpc.publicnode.com",
  op: process.env.OP_WS_URL || "wss://optimism-rpc.publicnode.com",
};

const BATCH_SIZE = 500; // logs per request
const MAX_BACKFILL_BLOCKS = 10_000; // safety rail

export async function runBackfillAll(force = false): Promise<void> {
  for (const chain of (["eth", "arb", "base", "op"] as Chain[])) {
    await runBackfillChain(chain, force);
  }
}

export async function runBackfillChain(chain: Chain, force = false): Promise<void> {
  const wm = await prisma.indexerCheckpoint.findUnique({ where: { chain } });
  if (!wm || wm.lastBlock === 0n) {
    console.log(`[backfill:${chain}] no checkpoint`);
    return;
  }

  const head = await headBlock(chain);
  const lag = head - wm.lastBlock;
  if (lag <= 0n) {
    console.log(`[backfill:${chain}] caught up`);
    return;
  }
  if (!force && lag > MAX_BACKFILL_BLOCKS) {
    console.log(`[backfill:${chain}] lag=${lag} > ${MAX_BACKFILL_BLOCKS}, skip`);
    return;
  }

  console.log(`[backfill:${chain}] backfilling ${lag} blocks`);
  const start = Number(wm.lastBlock + 1n);
  const end = Math.min(Number(head), start + BATCH_SIZE);

  const topics = ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]; // Transfer
  const addresses = await trackedAddresses(chain);

  const payload: Record<string, unknown> = {
    fromBlock: `0x${start.toString(16)}`,
    toBlock: `0x${end.toString(16)}`,
    topics,
  }
  if (addresses.length > 0) payload.address = addresses;

  const result = await rpcCall(PUBLIC_WS_URLS[chain].replace("wss://", "https://"), "eth_getLogs", [payload]);
  const logs: Record<string, unknown>[] = Array.isArray(result?.result) ? result.result : []

  console.log(`[backfill:${chain}] retrieved ${logs.length} logs`);

  const seen = new DedupeGate("bf");
  for (const log of logs) {
    const txHash = (log.transactionHash || "").toLowerCase();
    if (!txHash) continue;
    if (await seen.seen(chain, txHash)) continue;

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
    }).catch(() => {});
  }

  await prisma.indexerCheckpoint.update({
    where: { chain },
    data: { lastBlock: BigInt(end) },
  });
}

async function headBlock(chain: Chain): Promise<bigint> {
  const url = PUBLIC_WS_URLS[chain];
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 8_000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }));
      ws.on("message", (raw) => {
        const msg = JSON.parse((raw as Buffer).toString() ?? raw.toString?.());
        if (msg.method === "eth_subscription" && msg.params?.result?.number) {
          clearTimeout(t);
          ws.close();
          resolve(BigInt(parseInt(msg.params.result.number, 16)));
        }
      });
    });
    ws.on("error", (e) => { clearTimeout(t); ws.close(); reject(e); });
  });
}

async function trackedAddresses(chain: string): Promise<string[]> {
  const rows = await prisma.wallet.findMany({
    where: { chain },
    select: { address: true },
  });
  return rows.map((r) => r.address.toLowerCase());
}

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> { const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});
if (!res.ok) throw new Error(`rpc ${res.status}`);
return res.json(); }
