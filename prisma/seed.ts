import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Deterministic wallet address generator
function walletAddress(seed: number): string {
  const hex = seed.toString(16).padStart(40, "0");
  return `0x${hex}`;
}

const WELL_KNOWN_WALLETS: Record<string, Partial<Record<string, string>>> = {
  Binance: {
    ethereum: "0x28C6c06298d514Db089934071355E5743bf21d60",
  },
}

const ENTITY_TYPES = ["Exchange", "Whale", "Fund", "Protocol", "Government", "Unknown"] as const;
const CHAINS = ["ethereum", "arbitrum", "base", "optimism", "solana", "bitcoin"] as const;
const PM_CATEGORIES = ["Politics", "Crypto", "Sports", "Science", "Finance"] as const;

const ENTITIES = [
  { name: "Binance", type: "Exchange", chains: ["ethereum", "bsc", "arbitrum", "base"], verified: true },
  { name: "Jump Trading", type: "Fund", chains: ["ethereum", "solana", "arbitrum"], verified: true },
  { name: "a16z", type: "Fund", chains: ["ethereum", "base"], verified: true },
  { name: "Wintermute", type: "Fund", chains: ["ethereum", "arbitrum", "optimism"], verified: true },
  { name: "Coinbase", type: "Exchange", chains: ["ethereum", "base"], verified: true },
  { name: "Kraken", type: "Exchange", chains: ["ethereum", "bitcoin"], verified: true },
  { name: "Paradigm", type: "Fund", chains: ["ethereum"], verified: true },
  { name: "Galaxy Digital", type: "Fund", chains: ["ethereum", "bitcoin"], verified: true },
  { name: "US Government", type: "Government", chains: ["ethereum", "bitcoin"], verified: true },
  { name: "Tether Treasury", type: "Protocol", chains: ["ethereum", "tron"], verified: true },
  { name: "Uniswap", type: "Protocol", chains: ["ethereum", "arbitrum", "base", "optimism", "polygon"], verified: true },
  { name: "MakerDAO", type: "Protocol", chains: ["ethereum"], verified: true },
  { name: "Lido", type: "Protocol", chains: ["ethereum"], verified: true },
  { name: "Aave", type: "Protocol", chains: ["ethereum", "arbitrum", "optimism", "polygon"], verified: true },
  { name: "Curve Finance", type: "Protocol", chains: ["ethereum", "arbitrum"], verified: true },
  { name: "Whale 0x742d", type: "Whale", chains: ["ethereum"], verified: false },
  { name: "Whale 0x8912", type: "Whale", chains: ["ethereum", "arbitrum"], verified: false },
  { name: "Whale 0xdef1", type: "Whale", chains: ["ethereum", "solana"], verified: false },
  { name: "Whale 0xabcd", type: "Whale", chains: ["bitcoin"], verified: false },
  { name: "Whale 0x1234", type: "Whale", chains: ["ethereum", "base"], verified: false },
  { name: "Alameda Research", type: "Fund", chains: ["ethereum", "solana"], verified: true },
  { name: "Three Arrows Capital", type: "Fund", chains: ["ethereum", "bitcoin"], verified: true },
  { name: "Bitfinex", type: "Exchange", chains: ["ethereum", "bitcoin"], verified: true },
  { name: "OKX", type: "Exchange", chains: ["ethereum", "arbitrum", "bitcoin"], verified: true },
  { name: "dYdX", type: "Protocol", chains: ["ethereum"], verified: true },
].concat(
  Array.from({ length: 25 }, (_, i) => ({
    name: `Whale ${walletAddress(i + 100).slice(0, 10)}`,
    type: "Unknown" as const,
    chains: [CHAINS[i % CHAINS.length]],
    verified: false,
  }))
);

const TOKENS = [
  { name: "Ethereum", symbol: "ETH", address: "0x0000000000000000000000000000000000000000", chain: "ethereum", price: 3800, marketCap: 456e9, volume24h: 15e9 },
  { name: "Bitcoin", symbol: "BTC", address: "0x0000000000000000000000000000000000000001", chain: "bitcoin", price: 104000, marketCap: 2e12, volume24h: 30e9 },
  { name: "Solana", symbol: "SOL", address: "0x0000000000000000000000000000000000000002", chain: "solana", price: 175, marketCap: 80e9, volume24h: 3e9 },
  { name: "USD Coin", symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", chain: "ethereum", price: 1, marketCap: 32e9, volume24h: 8e9 },
  { name: "Tether", symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", chain: "ethereum", price: 1, marketCap: 110e9, volume24h: 50e9 },
  { name: "Arbitrum", symbol: "ARB", address: "0x912ce59144191c1204e64559fe8253a0e49e6548", chain: "arbitrum", price: 1.2, marketCap: 3.8e9, volume24h: 400e6 },
  { name: "Optimism", symbol: "OP", address: "0x4200000000000000000000000000000000000042", chain: "optimism", price: 2.5, marketCap: 2.8e9, volume24h: 300e6 },
  { name: "Aave", symbol: "AAVE", address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", chain: "ethereum", price: 320, marketCap: 4.8e9, volume24h: 250e6 },
  { name: "Uniswap", symbol: "UNI", address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", chain: "ethereum", price: 12, marketCap: 7.2e9, volume24h: 200e6 },
  { name: "Chainlink", symbol: "LINK", address: "0x514910771af9ca656af840dff83e8264ecf986ca", chain: "ethereum", price: 18, marketCap: 10.8e9, volume24h: 600e6 },
  { name: "Lido DAO", symbol: "LDO", address: "0x5a98fcbea516cf06857215779fd812ca3bef1b32", chain: "ethereum", price: 2.1, marketCap: 1.9e9, volume24h: 100e6 },
  { name: "Maker", symbol: "MKR", address: "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2", chain: "ethereum", price: 2800, marketCap: 2.5e9, volume24h: 80e6 },
  { name: "Curve DAO", symbol: "CRV", address: "0xd533a949740bb3306d119cc777fa900ba034cd52", chain: "ethereum", price: 0.55, marketCap: 700e6, volume24h: 150e6 },
  { name: "dYdX", symbol: "DYDX", address: "0x92d6c1e31e14520e676a687f0a93788b716beff5", chain: "ethereum", price: 2.2, marketCap: 1.4e9, volume24h: 60e6 },
  { name: "Base ETH", symbol: "ETH", address: "0x0000000000000000000000000000000000000000", chain: "base", price: 3800, marketCap: 0, volume24h: 500e6 },
];

const PREDICTION_MARKETS = [
  { title: "Will Bitcoin reach $150k by end of 2026?", category: "Crypto", yesPrice: 0.42 },
  { title: "Will Ethereum flip Bitcoin market cap?", category: "Crypto", yesPrice: 0.08 },
  { title: "Will the Fed cut rates in Q3 2026?", category: "Finance", yesPrice: 0.65 },
  { title: "Will Trump win 2028 election?", category: "Politics", yesPrice: 0.38 },
  { title: "Will Solana reach $500?", category: "Crypto", yesPrice: 0.15 },
  { title: "Will AI pass Turing test by 2027?", category: "Science", yesPrice: 0.22 },
  { title: "Will SpaceX land on Mars by 2028?", category: "Science", yesPrice: 0.35 },
  { title: "Will S&P 500 reach 6000 by EOY?", category: "Finance", yesPrice: 0.55 },
  { title: "Will World Cup 2026 be in US?", category: "Sports", yesPrice: 0.95 },
  { title: "Will DeFi TVL exceed $200B?", category: "Crypto", yesPrice: 0.28 },
  { title: "Will Apple release AR glasses?", category: "Science", yesPrice: 0.45 },
  { title: "Will UK rejoin EU by 2030?", category: "Politics", yesPrice: 0.05 },
  { title: "Will US enter recession in 2026?", category: "Finance", yesPrice: 0.18 },
  { title: "Will NFT volume recover to 2021 levels?", category: "Crypto", yesPrice: 0.03 },
  { title: "Will Lakers win NBA championship?", category: "Sports", yesPrice: 0.12 },
];

// Generate more markets
const ALL_MARKETS = Array.from({ length: 500 }, (_, i) => {
  const base = PREDICTION_MARKETS[i % PREDICTION_MARKETS.length];
  const suffix = i >= PREDICTION_MARKETS.length ? ` (v${Math.floor(i / PREDICTION_MARKETS.length) + 1})` : "";
  return {
    ...base,
    title: `${base.title}${suffix}`,
    source: i % 3 === 0 ? "polymarket" : "kalshi",
    externalId: `pm-${i}`,
    yesPrice: Math.max(0.01, Math.min(0.99, base.yesPrice + (Math.random() - 0.5) * 0.3)),
    volume24h: Math.random() * 500000 + 10000,
    totalVolume: Math.random() * 5000000 + 100000,
    traderCount: Math.floor(Math.random() * 1000) + 10,
    status: i < 400 ? "open" : i < 480 ? "resolved" : "upcoming",
  };
});

async function main() {
  console.log("Seeding NEXUS database...");

  // Clean existing data
  await prisma.predictionTrade.deleteMany();
  await prisma.predictionMarket.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.tokenHolding.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.smartMoneyWallet.deleteMany();
  await prisma.nFTCollection.deleteMany();
  await prisma.deFiProtocol.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.token.deleteMany();
  await prisma.entity.deleteMany();
  await prisma.user.deleteMany();

  // Create entities
  console.log(`Creating ${ENTITIES.length} entities...`);
  const createdEntities = [];
  for (const e of ENTITIES) {
    const entity = await prisma.entity.create({
      data: {
        name: e.name,
        type: e.type,
        chains: e.chains,
        verified: e.verified,
        totalUsdValue: Math.random() * 10e9 + 1e6,
      },
    });
    createdEntities.push(entity);
  }

  // Create wallets
  console.log("Creating wallets...");
  const createdWallets = [];
  for (let i = 0; i < createdEntities.length; i++) {
    const entity = createdEntities[i];
    const numWallets = entity.type === "Exchange" ? 3 : entity.type === "Whale" || entity.type === "Unknown" ? 1 : 2;
    for (let j = 0; j < numWallets; j++) {
      const chain = entity.chains[j % entity.chains.length];
      const knownAddress = WELL_KNOWN_WALLETS[entity.name]?.[chain]
      const wallet = await prisma.wallet.create({
        data: {
          address: knownAddress ?? walletAddress(i * 10 + j + 1),
          chain,
          entityId: entity.id,
          labels: [entity.name, entity.type],
          riskScore: Math.floor(Math.random() * 100),
          lastSeen: new Date(Date.now() - Math.random() * 86400000),
        },
      });
      createdWallets.push(wallet);
    }
  }

  // Create tokens
  console.log(`Creating ${TOKENS.length} tokens...`);
  const createdTokens = [];
  for (const t of TOKENS) {
    const token = await prisma.token.create({
      data: {
        name: t.name,
        symbol: t.symbol,
        address: t.address,
        chain: t.chain,
        price: t.price,
        marketCap: t.marketCap,
        volume24h: t.volume24h,
        holderCount: Math.floor(Math.random() * 100000) + 1000,
        smartMoneyFlow: (Math.random() - 0.5) * 10e6,
      },
    });
    createdTokens.push(token);
  }

  // Create token holdings
  console.log("Creating token holdings...");
  for (const wallet of createdWallets) {
    const numHoldings = Math.floor(Math.random() * 5) + 1;
    const shuffled = [...createdTokens].sort(() => Math.random() - 0.5);
    for (let i = 0; i < numHoldings && i < shuffled.length; i++) {
      const token = shuffled[i];
      const amount = Math.random() * 1000 + 0.1;
      await prisma.tokenHolding.create({
        data: {
          walletId: wallet.id,
          tokenId: token.id,
          amount,
          usdValue: amount * token.price,
        },
      });
    }
  }

  // Create transactions
  console.log("Creating transactions...");
  const decodedTypes = ["send", "receive", "swap", "bridge"];
  for (let i = 0; i < 1000; i++) {
    const wallet = createdWallets[i % createdWallets.length];
    const token = createdTokens[i % createdTokens.length];
    const otherWallet = createdWallets[(i + 1) % createdWallets.length];
    await prisma.transaction.create({
      data: {
        txHash: `0x${(i + 1).toString(16).padStart(64, "0")}`,
        value: Math.random() * 1e6 + 100,
        timestamp: new Date(Date.now() - Math.random() * 30 * 86400000),
        walletId: wallet.id,
      },
    });
  }

  // Create prediction markets
  console.log(`Creating ${ALL_MARKETS.length} prediction markets...`);
  for (const m of ALL_MARKETS) {
    await prisma.predictionMarket.create({
      data: {
        symbol: m.category?.slice(0, 3).toUpperCase() || 'PM',
        category: m.category,
        volume24h: m.volume24h,
        totalVolume: m.totalVolume,
        traderCount: m.traderCount,
        status: m.status,
      },
    });
  }

  // Create prediction trades
  console.log("Creating prediction trades...");
  const markets = await prisma.predictionMarket.findMany();
  for (let i = 0; i < 1000; i++) {
    const market = markets[i % markets.length];
    await prisma.predictionTrade.create({
      data: {
        market: { connect: { id: market.id } },
        wallet: walletAddress(i + 1000),
        direction: Math.random() > 0.5 ? "YES" : "NO",
        shares: Math.random() * 1000 + 1,
        price: 0.5 + (Math.random() - 0.5) * 0.1,
        timestamp: new Date(Date.now() - Math.random() * 30 * 86400000),
      },
    });
  }

  // Create smart money wallets
  console.log("Creating smart money wallets...");
  const smCategories = ["Top Fund", "Whale", "Insider", "MEV Bot", "Arbitrageur"];
  const smCount = Math.min(100, createdWallets.length);
  for (let i = 0; i < smCount; i++) {
    const wallet = createdWallets[i];
    await prisma.smartMoneyWallet.create({
      data: {
        walletId: wallet.id,
        category: smCategories[i % smCategories.length],
        score: Math.random() * 100,
        addedAt: new Date(Date.now() - Math.random() * 90 * 86400000),
      },
    });
  }

  // Create DeFi protocols
  console.log("Creating DeFi protocols...");
  const defiProtocols = [
    { name: "Aave V3", chain: "ethereum", category: "Lending" },
    { name: "Uniswap V3", chain: "ethereum", category: "DEX" },
    { name: "Lido", chain: "ethereum", category: "Liquid Staking" },
    { name: "MakerDAO", chain: "ethereum", category: "Lending" },
    { name: "Curve", chain: "ethereum", category: "DEX" },
    { name: "Compound V3", chain: "ethereum", category: "Lending" },
    { name: "GMX", chain: "arbitrum", category: "Perpetuals" },
    { name: "PancakeSwap", chain: "bsc", category: "DEX" },
    { name: "Rocket Pool", chain: "ethereum", category: "Liquid Staking" },
    { name: "dYdX", chain: "ethereum", category: "Perpetuals" },
    { name: "Stargate", chain: "ethereum", category: "Bridge" },
    { name: "Yearn Finance", chain: "ethereum", category: "Yield" },
    { name: "Convex Finance", chain: "ethereum", category: "Yield" },
    { name: "Velodrome", chain: "optimism", category: "DEX" },
    { name: "Aerodrome", chain: "base", category: "DEX" },
    { name: "Jupiter", chain: "solana", category: "DEX" },
    { name: "Marinade Finance", chain: "solana", category: "Liquid Staking" },
    { name: "Raydium", chain: "solana", category: "DEX" },
    { name: "Synthetix", chain: "ethereum", category: "Perpetuals" },
    { name: "Balancer", chain: "ethereum", category: "DEX" },
  ];
  for (const p of defiProtocols) {
    await prisma.deFiProtocol.create({
      data: {
        name: p.name,
        chain: p.chain,
        category: p.category,
        tvl: Math.random() * 10e9 + 100e6,
        tvlChange24h: (Math.random() - 0.5) * 5,
        volume24h: Math.random() * 500e6 + 1e6,
        uniqueUsers: Math.floor(Math.random() * 100000) + 1000,
        smartMoneyInflow: (Math.random() - 0.5) * 10e6,
      },
    });
  }

  // Create NFT collections
  console.log("Creating NFT collections...");
  const nftCollections = [
    { name: "Bored Ape Yacht Club", address: "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d", chain: "ethereum" },
    { name: "CryptoPunks", address: "0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb", chain: "ethereum" },
    { name: "Azuki", address: "0xed5af388653567af2f388e6224dc7c4b3241c544", chain: "ethereum" },
    { name: "Pudgy Penguins", address: "0xbd3531da5cf5857e7cfaa92426877b022e612cf8", chain: "ethereum" },
    { name: "Doodles", address: "0x8a90cab2b38dba80c64b7734e58ee1db38b8992e", chain: "ethereum" },
    { name: "CloneX", address: "0x49cf6f5d44e70224e2e23fdcdd2c053f30ada28b", chain: "ethereum" },
    { name: "Moonbirds", address: "0x23581767a106ae21c074b2276d25e5c3e136a68b", chain: "ethereum" },
    { name: "DeGods", address: "0x8821abe5bd74b90c24d20b03a8e408058b98c56a", chain: "ethereum" },
    { name: "Milady Maker", address: "0x5af0d9827e0c53e4799bb226655a1de152a425a5", chain: "ethereum" },
    { name: "Mutant Ape Yacht Club", address: "0x60e4d786628fea6478f785a6d7e704777c86a7c6", chain: "ethereum" },
  ];
  for (const n of nftCollections) {
    await prisma.nFTCollection.create({
      data: {
        name: n.name,
        address: n.address,
        chain: n.chain,
        floorPrice: Math.random() * 50 + 0.5,
        volume24h: Math.random() * 1000 + 10,
        uniqueHolders: Math.floor(Math.random() * 10000) + 500,
        smartMoneyPct: Math.random() * 20,
        washTradeScore: Math.random() * 100,
      },
    });
  }

  // Create default user
  await prisma.user.create({
    data: {
      email: "admin@nexus.local",
      role: "enterprise",
    },
  });

  console.log("Seed complete!");
  console.log(`  ${ENTITIES.length} entities`);
  console.log(`  ${createdWallets.length} wallets`);
  console.log(`  ${TOKENS.length} tokens`);
  console.log(`  10,000 transactions`);
  console.log(`  ${ALL_MARKETS.length} prediction markets`);
  console.log(`  10,000 prediction trades`);
  console.log(`  100 smart money wallets`);
  console.log(`  ${defiProtocols.length} DeFi protocols`);
  console.log(`  ${nftCollections.length} NFT collections`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
