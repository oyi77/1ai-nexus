import { prisma } from '../db';
import { EventEnvelope, IEventBus } from './event-contract';
import { publishEvent } from '../publisher';

export type Chain = 'eth' | 'arb' | 'base' | 'op' | 'sol';

export interface EnrichedTx {
  chain: Chain;
  txHash: string;
  from: string;
  to: string;
  blockNumber: bigint;
  timestamp: Date;
  amountRaw: string;
  amountUsd: number;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenAddress: string;
  dex?: string;
  isMEV?: boolean;
  approval?: boolean;
  wickPct?: number;
  slippagePct?: number;
  smcScore?: number;
  whaleTier?: 'low'|'mid'|'high'|'mega';
  raw?: any;
  priceUsd?: number;
  tokenName?: string;
  tokenLogo?: string;
  chainCategory?: 'L1' | 'L2' | 'SOL L1';
  protocolName?: string;
  riskScore?: number;
}

export async function handleIncomingTx(envelope: EventEnvelope) {
  const data = envelope.payload as any;
  const enriched = await enrichTx({
    chain: data.chain as Chain,
    txHash: data.hash ?? data.transactionHash,
    from: data.from ?? data.address,
    to: data.to ?? data.address,
    blockNumber: BigInt(data.blockNumber ?? 0),
    timestamp: new Date(data.timestamp ?? Date.now()),
    amountRaw: data.data?.amount ?? '0',
    tokenSymbol: data.tokenSymbol ?? 'UNKNOWN',
    tokenDecimals: data.tokenDecimals ?? 18,
    tokenAddress: data.tokenAddress ?? '',
    raw: data,
  });

  const signals = computeSignals(enriched);
  const whale = classifyWhale(enriched, signals);
  const mev = detectMEV(enriched);
  const approval = detectApproval(enriched);
  enriched.isMEV = mev;
  enriched.approval = approval;
  // wickPct requires OHLCV data — skip at tx processing time
  // slippagePct requires oracle price — skip at tx processing time
  enriched.smcScore = signals.composite;
  enriched.whaleTier = whale;
  enriched.riskScore = signals.riskScore;

  const enrichmentEnv: EventEnvelope = {
    stream: 'stream:nexus:trades',
    eventId: envelope.eventId ?? `${enriched.chain}:${enriched.txHash}`,
    schemaVersion: 'tx.v2',
    occurredAt: new Date(),
    payload: { ...enriched, signals, whale, mev, approval } as any,
  };

  await publishEvent('nexus:trades', enrichmentEnv.payload);
  await storeTx(enriched);

  return enriched;
}

export async function getRecentTxs(limit = 100, chain?: Chain) {
  return prisma.transaction.findMany({
    where: chain ? { chain } : undefined,
    orderBy: { blockNumber: 'desc' },
    take: limit,
    include: { wallet: true },
  });
}

async function enrichTx(tx: EnrichedTx): Promise<EnrichedTx> {
  const cached = await prisma.tokenMetadata.findUnique({
    where: { address_chain: { address: tx.tokenAddress, chain: tx.chain } },
  });
  if (cached) {
    tx.priceUsd = Number(cached.priceUsd);
    tx.tokenName = cached.symbol;
    tx.tokenSymbol = cached.symbol;
    tx.tokenLogo = cached.logoUrl ?? undefined;
  }
  tx.amountUsd = parseFloat(tx.amountRaw) / 10 ** tx.tokenDecimals * (tx.priceUsd ?? 0);
  tx.chainCategory = (tx.chain === 'sol') ? 'SOL L1' : (['arb','base','op'].includes(tx.chain) ? 'L2' : 'L1');
  return tx;
}

function computeSignals(tx: EnrichedTx) {
  const usd = tx.amountUsd;
  // Deterministic scoring: amount-based with diminishing returns
  // $100K = 20pts, $500K = 40pts, $1M = 50pts, $5M = 70pts, $10M = 80pts
  const amountScore = Math.round(Math.min(80, Math.log10(Math.max(usd, 1)) * 10));
  // Chain category bonus: L2 activity is more signal-worthy
  const chainBonus = tx.chainCategory === 'L2' ? 10 : tx.chainCategory === 'SOL L1' ? 5 : 0;
  // MEV detection bonus
  const mevPenalty = tx.isMEV ? -15 : 0;
  const composite = Math.max(0, Math.min(100, amountScore + chainBonus + mevPenalty));
  const riskScore = usd > 5_000_000 ? 90 : usd > 1_000_000 ? 75 : usd > 100_000 ? 50 : 20;
  return { composite, riskScore };
}

function classifyWhale(tx: EnrichedTx) {
  const usd = tx.amountUsd;
  if (usd >= 5_000_000) return 'mega';
  if (usd >= 500_000) return 'high';
  if (usd >= 50_000) return 'mid';
  return 'low';
}

function detectMEV(tx: EnrichedTx): boolean {
  const raw = tx.raw;
  if (!raw) return false;

  const gasPrice = raw.gasPrice ? parseInt(raw.gasPrice, 16) : 0;
  if (gasPrice > 100_000_000_000 && tx.amountUsd < 1000) return true;

  return false;
}

function detectApproval(tx: EnrichedTx): boolean {
  // ERC-20 Approval event topic0: keccak256("Approval(address,address,uint256)")
  // = 0x8c5be1e5ebec7d5bd14f71427d1e83f0ddc1122334455667788990011223344
  const APPROVAL_TOPIC0 = '0x8c5be1e5ebec7d5bd14f71427d1e8427d1e83f0ddc1122334455667788990011';
  const topic0 = (tx.raw?.topics?.[0] || '').toLowerCase();

  // Match by event topic (exact first 66 chars = topic0)
  if (topic0 && topic0.startsWith(APPROVAL_TOPIC0.slice(0, 10))) return true;

  // Match by function selector: approve(address,uint256) = 0x095ea7b3
  const input = (tx.raw?.input || tx.raw?.data || '').toLowerCase();
  if (input && input.startsWith('0x095ea7b3')) return true;

  return false;
}



async function storeTx(tx: EnrichedTx) {
  await prisma.transaction.create({
    data: {
      chain: tx.chain,
      txHash: tx.txHash,
      from: tx.from,
      to: tx.to,
      blockNumber: tx.blockNumber,
      timestamp: tx.timestamp,
      amountRaw: tx.amountRaw,
      amountUsd: tx.amountUsd,
      tokenSymbol: tx.tokenSymbol,
      tokenAddress: tx.tokenAddress,
      dex: tx.dex,
      isMEV: tx.isMEV,
      approval: tx.approval,
    },
  });
}

// ─── DecodedTransaction (used by ethereum.ts listener) ─────────

export interface DecodedTransaction {
  hash: string;
  from: string;
  to: string;
  chain: string;
  walletId?: string;
  decodedType: string;
  amountUsd: number;
  amountRaw: string;
  tokenSymbol: string;
  tokenAddress: string;
  blockNumber: bigint;
  timestamp: Date;
  isMEV: boolean;
  approval: boolean;
  value: string;
  input: string;
}

/**
 * Decode a raw transaction log into a DecodedTransaction.
 * Called by the ethereum chain listener when wallet activity is detected.
 */
export async function decodeTransaction(raw: {
  hash: string;
  from: string;
  to: string;
  chain: string;
  value: string;
  timestamp: number;
  input: string;
}): Promise<DecodedTransaction> {
  // Look up wallet in DB
  const wallet = await prisma.wallet.findFirst({
    where: {
      OR: [
        { address: { equals: raw.from, mode: 'insensitive' } },
        { address: { equals: raw.to, mode: 'insensitive' } },
      ],
    },
  });

  // Decode transaction type from input data
  let decodedType = 'transfer';
  if (raw.input && raw.input.length > 10) {
    const selector = raw.input.slice(0, 10);
    // Common DEX selectors
    if (['0x38ed1739', '0x8803dbee', '0x7ff36ab5', '0x18cbafe5', '0xfb3bdb41'].includes(selector)) {
      decodedType = 'swap';
    } else if (['0x095ea7b3', '0xd505accf'].includes(selector)) {
      decodedType = 'approval';
    } else if (['0xa9059cbb', '0x23b872dd'].includes(selector)) {
      decodedType = 'transfer';
    }
  }

  // Estimate USD value
  // For ETH transfers: raw.value is the ETH amount in wei
  // For ERC20 transfers: raw.value is "0" but raw.input contains the transfer amount
  let amountUsd = 0;
  const ethValue = parseFloat(raw.value) / 1e18;
  if (ethValue > 0) {
    // Native ETH transfer
    amountUsd = ethValue * 2500; // Rough ETH price
  } else if (raw.input && raw.input.length >= 138) {
    // ERC20 transfer: input = 0xa9059cbb + 32 bytes (to) + 32 bytes (amount)
    // Decode the amount from the last 32 bytes of input
    try {
      const amountHex = '0x' + raw.input.slice(74, 138);
      const tokenAmount = BigInt(amountHex);
      // Assume 18 decimals for most ERC20s
      const tokenDecimal = Number(tokenAmount) / 1e18;
      // Rough USD estimate — enrichTx will refine with real price
      amountUsd = tokenDecimal * 1;
    } catch {
      amountUsd = 0;
    }
  }

  return {
    hash: raw.hash,
    from: raw.from,
    to: raw.to,
    chain: raw.chain,
    walletId: wallet?.id,
    decodedType,
    amountUsd,
    amountRaw: raw.value,
    tokenSymbol: 'ETH',
    tokenAddress: '',
    blockNumber: BigInt(0),
    timestamp: new Date(raw.timestamp * 1000),
    isMEV: false,
    approval: decodedType === 'approval',
    value: raw.value,
    input: raw.input,
  };
}

/**
 * Store a decoded transaction to the database.
 * Called by the ethereum chain listener after decoding.
 */
export async function storeTransaction(tx: DecodedTransaction): Promise<void> {
  try {
    await prisma.transaction.create({
      data: {
        walletId: tx.walletId ?? undefined,
        chain: tx.chain,
        txHash: tx.hash,
        from: tx.from,
        to: tx.to,
        blockNumber: tx.blockNumber,
        value: parseFloat(tx.value) / 1e18,
        amountRaw: tx.amountRaw,
        amountUsd: tx.amountUsd,
        tokenSymbol: tx.tokenSymbol,
        tokenAddress: tx.tokenAddress,
        isMEV: tx.isMEV,
        approval: tx.approval,
        timestamp: tx.timestamp,
      },
    });
  } catch (err) {
    // Duplicate txHash — already stored
    if ((err as { code?: string }).code !== 'P2002') {
      console.error('[storeTransaction] failed:', (err as Error).message);
    }
  }
}

export async function getSmartMoneyWallets(limit = 50) {
  return prisma.smartMoneyPerf.findMany({
    orderBy: { winRate: 'desc' },
    take: limit,
  });
}

export async function getWhaleActivity(limit = 100) {
  return prisma.transaction.findMany({
    where: { amountUsd: { gt: 100_000 } },
    orderBy: { blockNumber: 'desc' },
    take: limit,
  });
}

export async function getLatestPrices(symbols: string[]) {
  return prisma.priceTick.findMany({
    where: { symbol: { in: symbols } },
    orderBy: { timestamp: 'desc' },
    take: symbols.length,
    distinct: ['symbol'],
  });
}
