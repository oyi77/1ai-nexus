import { prisma } from "../db";
import { publishEvent } from "../publisher";

const BLOCKSTREAM_API = "https://blockstream.info/api";
const POLL_INTERVAL_MS = 30_000; // 30 seconds

// Cached BTC price (refreshed every 5 minutes)
let cachedBtcPrice = 0;
let lastPriceFetch = 0;
const PRICE_CACHE_MS = 5 * 60 * 1000;

async function getBtcPrice(): Promise<number> {
  const now = Date.now();
  if (cachedBtcPrice > 0 && now - lastPriceFetch < PRICE_CACHE_MS) {
    return cachedBtcPrice;
  }
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    if (res.ok) {
      const data = await res.json() as { bitcoin?: { usd?: number } };
      if (data.bitcoin?.usd) {
        cachedBtcPrice = data.bitcoin.usd;
        lastPriceFetch = now;
      }
    }
  } catch {
    // Use cached price if available
  }
  return cachedBtcPrice;
}

export async function startBitcoinListener() {
  console.log("[bitcoin] starting polling (every 30s)");
  pollBitcoin();
}

async function pollBitcoin() {
  try {
    // Get tracked BTC wallets
    const wallets = await prisma.wallet.findMany({
      where: { chain: { in: ["bitcoin", "btc"] } },
      select: { address: true },
    });

    if (wallets.length === 0) {
      console.log("[bitcoin] no wallets to track");
    } else {
      // Poll wallets in parallel with concurrency limit
      const CONCURRENCY = 10;
      for (let i = 0; i < wallets.length; i += CONCURRENCY) {
        const batch = wallets.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map((w) => checkWallet(w.address)));
      }
    }

    // Update checkpoint with latest block
    const tipHeight = await fetchTipHeight();
    if (tipHeight) {
      await prisma.indexerCheckpoint.upsert({
        where: { chain: { in: ["bitcoin", "btc"] } },
        update: { lastBlock: BigInt(tipHeight), updatedAt: new Date() },
        create: { chain: "btc", lastBlock: BigInt(tipHeight) },
      });
    }
  } catch (err) {
    console.error("[bitcoin] poll error:", err);
  }

  setTimeout(pollBitcoin, POLL_INTERVAL_MS);
}

async function fetchTipHeight(): Promise<number | null> {
  try {
    const res = await fetch(`${BLOCKSTREAM_API}/blocks/tip/height`);
    if (!res.ok) return null;
    const text = await res.text();
    return parseInt(text, 10);
  } catch {
    return null;
  }
}

async function checkWallet(address: string) {
  try {
    const res = await fetch(`${BLOCKSTREAM_API}/address/${address}/txs`);
    if (!res.ok) return;

    const txs = (await res.json()) as Array<{
      txid: string;
      status: { confirmed: boolean; block_time?: number };
      vin: Array<{ prevout: { scriptpubkey_address: string; value: number } }>;
      vout: Array<{ scriptpubkey_address: string; value: number }>;
    }>;

    for (const tx of txs.slice(0, 5)) {
      // Check last 5 transactions
      if (!tx.status.confirmed) continue;

      const totalIn = tx.vin
        .filter((v) => v.prevout.scriptpubkey_address === address)
        .reduce((sum, v) => sum + v.prevout.value, 0);

      const totalOut = tx.vout
        .filter((v) => v.scriptpubkey_address === address)
        .reduce((sum, v) => sum + v.value, 0);

      const isReceive = totalOut > totalIn;
      const amountBtc = Math.abs(totalOut - totalIn) / 1e8;
      const btcPrice = await getBtcPrice();

      await publishEvent("nexus:trades", {
        chain: "btc",
        hash: tx.txid,
        address,
        direction: isReceive ? "receive" : "send",
        amountBtc,
        amountUsd: btcPrice > 0 ? amountBtc * btcPrice : 0,
        priceUsd: btcPrice,
        timestamp: tx.status.block_time ? new Date(tx.status.block_time * 1000).toISOString() : new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error(`[bitcoin] wallet check error for ${address}:`, err);
  }
}
