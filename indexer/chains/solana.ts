import WebSocket from "ws";
import { prisma } from "../db";
import { publishEvent } from "../publisher";

// Free public Solana WebSocket RPC (no API key needed)
const SOLANA_WS_URL = process.env.SOLANA_WS_URL || "wss://api.mainnet-beta.solana.com";
const LAMPORTS_PER_SOL = 1_000_000_000;

// Cached SOL price (refreshed every 5 minutes)
let cachedSolPrice = 0;
let lastPriceFetch = 0;
const PRICE_CACHE_MS = 5 * 60 * 1000;

async function getSolPrice(): Promise<number> {
  const now = Date.now();
  if (cachedSolPrice > 0 && now - lastPriceFetch < PRICE_CACHE_MS) {
    return cachedSolPrice;
  }
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    if (res.ok) {
      const data = await res.json() as { solana?: { usd?: number } };
      if (data.solana?.usd) {
        cachedSolPrice = data.solana.usd;
        lastPriceFetch = now;
      }
    }
  } catch {
    // Use cached price if available
  }
  return cachedSolPrice;
}

export async function startSolanaListener() {
  connectSolana();
}

// Reconnect backoff state
let solReconnectAttempts = 0;
const SOL_MAX_RECONNECT_DELAY = 60_000;
const SOL_BASE_RECONNECT_DELAY = 1_000;

function getSolReconnectDelay(): number {
  const delay = Math.min(SOL_BASE_RECONNECT_DELAY * Math.pow(2, solReconnectAttempts), SOL_MAX_RECONNECT_DELAY);
  solReconnectAttempts++;
  const jitter = delay * 0.3 * Math.random();
  return Math.round(delay + jitter);
}

function connectSolana() {
  console.log(`[solana] connecting to ${SOLANA_WS_URL}...`);

  const ws = new WebSocket(SOLANA_WS_URL);

  ws.on("open", async () => {
    console.log("[solana] connected");
    solReconnectAttempts = 0;
    // Get tracked SOL wallets
    const wallets = await prisma.wallet.findMany({
      where: { chain: { in: ["solana", "sol"] } },
      select: { address: true },
    });

    if (wallets.length === 0) {
      console.log("[solana] no wallets to track");
      return;
    }

    // Subscribe to account changes for each wallet (standard Solana WebSocket)
    for (const wallet of wallets) {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "accountSubscribe",
          params: [wallet.address, { encoding: "jsonParsed", commitment: "confirmed" }],
        })
      );
    }
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Account change notification
      if (msg.method === "accountNotification") {
        const account = msg.params.result.value;
        const pubkey = msg.params.subscription;
        const solAmount = account.lamports / LAMPORTS_PER_SOL;
        const solPrice = await getSolPrice();

        // Publish to Redis with USD conversion
        await publishEvent("nexus:trades", {
          chain: "sol",
          address: pubkey,
          lamports: account.lamports,
          amountSol: solAmount,
          amountUsd: solPrice > 0 ? solAmount * solPrice : 0,
          priceUsd: solPrice,
          timestamp: new Date().toISOString(),
        });

        // Update checkpoint
        await prisma.indexerCheckpoint.upsert({
          where: { chain: { in: ["solana", "sol"] } },
          update: { updatedAt: new Date() },
          create: { chain: "sol", lastBlock: BigInt(0) },
        });
      }
    } catch (err) {
      console.error("[solana] message error:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("[solana] error:", err.message);
  });

  ws.on("close", () => {
    const delay = getSolReconnectDelay();
    console.log(`[solana] disconnected, reconnecting in ${Math.round(delay / 1000)}s...`);
    setTimeout(connectSolana, delay);
  });
}
