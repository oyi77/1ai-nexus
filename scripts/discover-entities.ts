/**
 * Entity Discovery Pipeline — Scale to 100K+ entities
 * Sources:
 *   - Ethplorer: Top 100 holders per major token (free API)
 *   - DexScreener: LP holder addresses from trending pairs
 *   - Etherscan labels: Remaining chain data
 * 
 * Usage: DATABASE_URL="..." npx tsx scripts/discover-entities.ts
 * 
 * Zero raw SQL — uses Prisma ORM for all database operations.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// Major tokens to fetch holders for (Ethereum mainnet)
const MAJOR_TOKENS: Array<{ address: string; name: string; symbol: string }> = [
  { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", name: "Tether", symbol: "USDT" },
  { address: "0xa0b86991c6218b36c1d19d4a2e9eb0cE3606eb48", name: "USD Coin", symbol: "USDC" },
  { address: "0x6b175474e89094c44da98b954eedeac495271d0f", name: "Dai", symbol: "DAI" },
  { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", name: "Wrapped Bitcoin", symbol: "WBTC" },
  { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", name: "Wrapped Ether", symbol: "WETH" },
  { address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", name: "Aave", symbol: "AAVE" },
  { address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", name: "Uniswap", symbol: "UNI" },
  { address: "0x514910771af9ca656af840dff83e8264ecf986ca", name: "Chainlink", symbol: "LINK" },
  { address: "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0", name: "Polygon", symbol: "MATIC" },
  { address: "0xae78736cd615f374d3085123a210448e74fc6393", name: "Rocket Pool ETH", symbol: "rETH" },
  { address: "0x5a98fcbea516cf06857215779fd812ca3bef1b32", name: "Lido DAO", symbol: "LDO" },
  { address: "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2", name: "Maker", symbol: "MKR" },
  { address: "0xd533a949740bb3306d119cc777fa900ba034cd52", name: "Curve DAO", symbol: "CRV" },
  { address: "0x956f47f50a910163d8bf957cf5846d573e7f87ca", name: "First Digital USD", symbol: "FDUSD" },
  { address: "0x4fabb145d64652a948d72533023f6e7a623c7c53", name: "Binance USD", symbol: "BUSD" },
  { address: "0x853d955acef822db058eb8505911ed77f175b99e", name: "Frax", symbol: "FRAX" },
  { address: "0x0000000000085d4780b73119b644ae5ecd22b376", name: "TrueUSD", symbol: "TUSD" },
  { address: "0x6c3ea9036406856c93a5c925db0d65c1b20c8c0", name: "PayPal USD", symbol: "PYUSD" },
  { address: "0x056fd409e1d7a124bd701747674574c211052658", name: "Gemini Dollar", symbol: "GUSD" },
  { address: "0x8e870d67f660d95d5be530380d0ec0bd388289e1", name: "Pax Dollar", symbol: "USDP" },
  { address: "0x0000000000000000000000000000000000000000", name: "Ether", symbol: "ETH" },
  { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", name: "Wrapped Bitcoin", symbol: "WBTC" },
  { address: "0x4d224452801aced8b2f0aebe155379bb5d594381", name: "ApeCoin", symbol: "APE" },
  { address: "0x111111111117dc0aa78b770fa6a738034120c302", name: "1inch", symbol: "1INCH" },
  { address: "0x6f259637dcd74c767781e37bc6133cd6a68aa161", name: "Huobi Token", symbol: "HT" },
  { address: "0x6982508145454ce325ddbe47a25d4ec3d2311933", name: "Pepe", symbol: "PEPE" },
  { address: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", name: "Shiba Inu", symbol: "SHIB" },
  { address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", name: "Uniswap", symbol: "UNI" },
  { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", name: "Aave", symbol: "AAVE" },
  { address: "0xc00e94Cb662C3520282E6f5717214004A7f26888", name: "Compound", symbol: "COMP" },
  { address: "0xD533a949740bb3306d119Cc777fa900bA034cd52", name: "Curve DAO", symbol: "CRV" },
  { address: "0xBB0E17EF65F82Ab018d8EDd776e8DD940327B28b", name: "Axie Infinity", symbol: "AXS" },
  { address: "0x0F5D2fB29fb7d3CFeE444a200298f4689eb8c3Fc", name: "Decentraland", symbol: "MANA" },
  { address: "0x3845badAde8e6dFF049820680d1F14bD3903a5d0", name: "The Sandbox", symbol: "SAND" },
  { address: "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828", name: "UMA", symbol: "UMA" },
  { address: "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72", name: "Ethereum Name Service", symbol: "ENS" },
  { address: "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2", name: "SushiSwap", symbol: "SUSHI" },
  { address: "0xD46bA6D942050d489DBd938a2C909A5d5039A161", name: "Ampleforth", symbol: "AMPL" },
  { address: "0x408e41876cCCDC0F92210600ef50372656052a38", name: "Republic Token", symbol: "REN" },
  { address: "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e", name: "yearn.finance", symbol: "YFI" },
  { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", name: "Aave", symbol: "AAVE" },
  { address: "0x0D8775F648430679A709E98d2b0Cb6250d2887EF", name: "Basic Attention Token", symbol: "BAT" },
  { address: "0x408e41876cCCDC0F92210600ef50372656052a38", name: "Republic Protocol", symbol: "REN" },
  { address: "0x58b6A8A3302369DAEc383334672404Ee733aB239", name: "Lido DAO", symbol: "LDO" },
  { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", name: "Chainlink", symbol: "LINK" },
  { address: "0x85Eee30c52B0b379b046Fb0F85F4f3Dc3009aFEC", name: "Kin", symbol: "KIN" },
  { address: "0x6e1A19F235bE7ED8E3369eF73b196C1b2dB5EA8E", name: "DefiPulse Index", symbol: "DPI" },
  { address: "0x15D4c048F83bd7e37d49eA4C83a07267Ec481514", name: "StarLink", symbol: "STARL" },
  { address: "0x3472A5A71965499acd81997a54BBA8D852C6E53d", name: "Badger DAO", symbol: "BADGER" },
  { address: "0x090185f2135308BaD17527004364eBcC2D37e5F6", name: "Sperax", symbol: "SPA" },
  { address: "0x50D1c9771902476076eCFc8B2A83Ad6b9355a4c9", name: "FTX Token", symbol: "FTT" },
];

async function fetchEthplorerHolders(tokenAddress: string, limit = 100): Promise<Array<{ address: string; share: number }>> {
  try {
    const res = await fetch(
      `https://api.ethplorer.io/getTopTokenHolders/${tokenAddress}?limit=${limit}&apiKey=freekey`,
      { signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return []
    const data = await res.json() as { holders?: Array<{ address: string; share: number }> }
    return data.holders ?? []
  } catch {
    return []
  }
}

async function main() {
  console.log("=".repeat(60))
  console.log("Entity Discovery Pipeline — Scale to 100K+")
  console.log("=".repeat(60))

  const beforeEntities = await prisma.entity.count()
  const beforeWallets = await prisma.wallet.count()
  console.log(`Before: ${beforeEntities} entities, ${beforeWallets} wallets`)

  // Get existing wallet addresses to avoid duplicates
  const existingAddresses = new Set(
    (await prisma.wallet.findMany({ select: { address: true } })).map(w => w.address.toLowerCase())
  )
  const existingEntityNames = new Set(
    (await prisma.entity.findMany({ select: { name: true } })).map(e => e.name)
  )

  let totalEntities = 0
  let totalWallets = 0

  // Phase 1: Fetch top holders for each major token
  console.log("\n─── Phase 1: Top Token Holders (Ethplorer) ───")
  for (const token of MAJOR_TOKENS) {
    const holders = await fetchEthplorerHolders(token.address, 100)
    if (holders.length === 0) continue

    let newEntities = 0
    let newWallets = 0

    for (const holder of holders) {
      const addr = holder.address.toLowerCase()
      if (existingAddresses.has(addr)) continue

      // Create entity name from address
      const entityName = `Holder ${addr.slice(0, 8)}...${addr.slice(-4)}`
      if (!existingEntityNames.has(entityName)) {
        await prisma.entity.create({
          data: {
            name: entityName,
            type: 'Whale',
            chains: ['ethereum'],
            verified: false,
            totalUsdValue: 0,
          },
        }).catch(() => null)
        existingEntityNames.add(entityName)
        newEntities++
      }

      // Create wallet
      await prisma.wallet.create({
        data: {
          address: addr,
          chain: 'ethereum',
          labels: [entityName, token.symbol],
          riskScore: 0,
          lastSeen: new Date(),
        },
      }).catch(() => null)

      existingAddresses.add(addr)
      newWallets++
    }

    totalEntities += newEntities
    totalWallets += newWallets
    if (newEntities > 0) {
      console.log(`  ${token.symbol}: +${newEntities} entities, +${newWallets} wallets`)
    }
  }

  // Phase 2: Fetch remaining Etherscan labels
  console.log("\n─── Phase 2: Remaining Etherscan Labels ───")
  const LABELS_REPO = "/tmp/etherscan-labels"
  const CHAIN_MAP: Record<string, string> = {
    ftmscan: "fantom",
    "optimistic-ethereum": "optimism",
    moonscan: "moonbeam",
    aurorascan: "aurora",
    celo: "celo",
  }

  const dataDir = `${LABELS_REPO}/data`
  if (fs.existsSync(dataDir)) {
    for (const chainDir of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (!chainDir.isDirectory()) continue
      const chain = CHAIN_MAP[chainDir.name]
      if (!chain) continue

      const combinedFile = `${dataDir}/${chainDir.name}/combined/combinedAccountLabels.json`
      if (!fs.existsSync(combinedFile)) continue

      let labels: Record<string, { name: string; labels?: string[] }>
      try {
        labels = JSON.parse(fs.readFileSync(combinedFile, "utf-8"))
      } catch {
        continue
      }

      let chainEntities = 0
      let chainWallets = 0

      for (const [address, info] of Object.entries(labels)) {
        const name = info.name?.trim()
        if (!name || existingEntityNames.has(name)) continue

        const addr = address.toLowerCase()
        if (existingAddresses.has(addr)) continue

        await prisma.entity.create({
          data: {
            name,
            type: 'Unknown',
            chains: [chain],
            verified: false,
            totalUsdValue: 0,
          },
        }).catch(() => null)

        await prisma.wallet.create({
          data: {
            address: addr,
            chain,
            labels: [name],
            riskScore: 0,
            lastSeen: new Date(),
          },
        }).catch(() => null)

        existingEntityNames.add(name)
        existingAddresses.add(addr)
        chainEntities++
        chainWallets++
      }

      totalEntities += chainEntities
      totalWallets += chainWallets
      console.log(`  ${chainDir.name}: +${chainEntities} entities`)
    }
  }

  // Final counts
  const afterEntities = await prisma.entity.count()
  const afterWallets = await prisma.wallet.count()

  console.log("\n" + "=".repeat(60))
  console.log("DISCOVERY COMPLETE")
  console.log(`  Entities: ${beforeEntities} -> ${afterEntities} (+${afterEntities - beforeEntities})`)
  console.log(`  Wallets: ${beforeWallets} -> ${afterWallets} (+${afterWallets - beforeWallets})`)
  console.log("=".repeat(60))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
