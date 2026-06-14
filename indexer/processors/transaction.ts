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
  enriched.wickPct = estimateWickPct(enriched);
  enriched.slippagePct = estimateSlippagePct(enriched);
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
  const composite = Math.round(Math.min(100, (usd / 100_000) * 20 + Math.random() * 5));
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
  const receipt =
    raw.receipt?.status ??
    raw.status ??
    raw.result;
  if (receipt && receipt === '0x0') return true;
  return false;
}

function detectApproval(tx: EnrichedTx): boolean {
  const to = (tx.to || '').toLowerCase();
  const topic0 = (tx.raw?.topics?.[0] || '').toLowerCase();
  const approvalTopic = '0x8c5be1e5ebec7d5bd14f71427d1e83f0ddc112233445566778899001122334455'.slice(0, 10);
  if (topic0 && topic0.startsWith(approvalTopic.slice(0, 10))) return true;
  if (to && /approve/.test(to)) return true;
  return false;
}

function estimateWickPct(_tx: EnrichedTx): number | undefined {
  // Wick estimation requires OHLC trades/Candles; without price candles we keep undefined.
  return undefined;
}

function estimateSlippagePct(_tx: EnrichedTx): number | undefined {
  // Slippage requires execution price vs oracle; placeholder for future oracle hook.
  return undefined;
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
    } as any,
  });
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
