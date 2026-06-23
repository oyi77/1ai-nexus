import WebSocket from "ws";
import { prisma } from "../db";
import { decodeTransaction, storeTransaction } from "../processors/transaction";
import { detectSmartMoneyActivity } from "../processors/smart-money";
import { publishEvent } from "../publisher";

// Reconnect backoff state per chain
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECT_DELAY = 60_000; // 60 seconds max
const BASE_RECONNECT_DELAY = 1_000; // 1 second base

function getReconnectDelay(chain: string): number {
  const attempts = reconnectAttempts.get(chain) ?? 0;
  reconnectAttempts.set(chain, attempts + 1);
  const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempts), MAX_RECONNECT_DELAY);
  const jitter = delay * 0.3 * Math.random();
  return Math.round(delay + jitter);
}

function resetReconnectAttempts(chain: string) {
  reconnectAttempts.set(chain, 0);
}


// Free public WebSocket RPC endpoints (no API key needed)
const CHAINS = ["eth", "arb", "base", "op"] as const;
type Chain = (typeof CHAINS)[number];

const PUBLIC_WS_URLS: Record<Chain, string> = {
  eth: process.env.ETH_WS_URL || "wss://ethereum-rpc.publicnode.com",
  arb: process.env.ARB_WS_URL || "wss://arbitrum-one-rpc.publicnode.com",
  base: process.env.BASE_WS_URL || "wss://base-rpc.publicnode.com",
  op: process.env.OP_WS_URL || "wss://optimism-rpc.publicnode.com",
};

interface BlockHeader {
  hash: string;
  number: string;
  timestamp: string;
}

export async function startEthereumListener() {
  for (const chain of CHAINS) {
    connectChain(chain);
  }
}

function connectChain(chain: Chain) {
  const url = PUBLIC_WS_URLS[chain];
  console.log(`[ethereum:${chain}] connecting to ${url}...`);

  const ws = new WebSocket(url);

  ws.on("open", async () => {
    console.log(`[ethereum:${chain}] connected`);
    resetReconnectAttempts(chain);

    // Get tracked wallet addresses
    // Map short chain IDs to full names used in DB
    const CHAIN_ALIASES: Record<string, string[]> = {
      eth: ['ethereum', 'eth', 'multi-chain'],
      arb: ['arbitrum', 'arb'],
      base: ['base'],
      op: ['optimism', 'op'],
    };
    const chainNames = CHAIN_ALIASES[chain] ?? [chain];
    const wallets = await prisma.wallet.findMany({
      where: { chain: { in: chainNames } },
      select: { address: true },
    });

    if (wallets.length === 0) {
      console.log(`[ethereum:${chain}] no wallets to track, subscribing to new blocks only`);
    }

    // Subscribe to new blocks (standard eth_subscribe)
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_subscribe",
        params: ["newHeads"],
      })
    );

    // Subscribe to logs for tracked wallets (standard eth_subscribe)
    if (wallets.length > 0) {
      const addresses = wallets.map((w: { address: string }) => w.address.toLowerCase());
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "eth_subscribe",
          params: [
            "logs",
            {
              address: addresses,
            },
          ],
        })
      );
    }
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // New block notification
      if (msg.method === "eth_subscription" && msg.params?.result?.number) {
        const header: BlockHeader = msg.params.result;
        console.log(`[ethereum:${chain}] new block ${parseInt(header.number, 16)}`);

        // Update checkpoint
        await prisma.indexerCheckpoint.upsert({
          where: { chain },
          update: { lastBlock: BigInt(parseInt(header.number, 16)), updatedAt: new Date() },
          create: { chain, lastBlock: BigInt(parseInt(header.number, 16)) },
        });
      }

      // Log notification (wallet activity)
      if (msg.method === "eth_subscription" && msg.params?.result?.transactionHash) {
        const log = msg.params.result;
        const tx = await decodeTransaction({
          hash: log.transactionHash,
          from: log.address,
          to: log.address,
          chain,
          value: "0",
          timestamp: Math.floor(Date.now() / 1000),
          input: log.data || "0x",
        });

        await storeTransaction(tx);
        await detectSmartMoneyActivity(tx);

        await publishEvent("nexus:trades", {
          chain,
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          decodedType: tx.decodedType,
          amountUsd: tx.amountUsd,
          timestamp: tx.timestamp.toISOString(),
        });
      }
    } catch (err) {
      console.error(`[ethereum:${chain}] message error:`, err);
    }
  });

  ws.on("error", (err) => {
    console.error(`[ethereum:${chain}] error:`, err.message);
  });

  ws.on("close", () => {
    const delay = getReconnectDelay(chain);
    console.log(`[ethereum:${chain}] disconnected, reconnecting in ${Math.round(delay / 1000)}s...`);
    setTimeout(() => connectChain(chain), delay);
  });
}
