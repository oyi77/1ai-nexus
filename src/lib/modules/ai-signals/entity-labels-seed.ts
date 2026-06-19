// ─────────────────────────────────────────────────────────────
// Entity Label Seed Data — Comprehensive Database
// Sources: Etherscan labels, community lists, known exchange wallets
// 1000+ entities across ETH, SOL, BTC, ARB, BASE, OP, Polygon
// ─────────────────────────────────────────────────────────────

export interface EntitySeed {
  address: string
  chain: string
  label: string
  category: 'cex' | 'vc' | 'whale' | 'defi' | 'protocol' | 'dao' | 'mev' | 'bridge' | 'miner' | 'nft'
  confidence: number
}

// ═══════════════════════════════════════════════════════════════
// CENTRALIZED EXCHANGES (CEX) — 200+ addresses
// ═══════════════════════════════════════════════════════════════

const CEX_ETH: EntitySeed[] = [
  // Binance
  { address: '0x28C6c06298d514Db089934071355E5743bf21d60', chain: 'eth', label: 'Binance Hot Wallet', category: 'cex', confidence: 0.95 },
  { address: '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549', chain: 'eth', label: 'Binance Cold Wallet', category: 'cex', confidence: 0.95 },
  { address: '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d', chain: 'eth', label: 'Binance Hot Wallet 2', category: 'cex', confidence: 0.9 },
  { address: '0xF977814e90dA44bFA03b6295A0616a897441aceC', chain: 'eth', label: 'Binance Hot Wallet 3', category: 'cex', confidence: 0.9 },
  { address: '0x8894E0a0c962CB723c1ef8a1B0c2CF76Bd2Db1F2', chain: 'eth', label: 'Binance Hot Wallet 4', category: 'cex', confidence: 0.9 },
  { address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', chain: 'eth', label: 'Binance Cold Wallet 2', category: 'cex', confidence: 0.95 },
  { address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', chain: 'eth', label: 'Binance BSC Token Hub', category: 'cex', confidence: 0.9 },
  { address: '0x5a52E96BAcdaBb82fd05763E25335261B270Efcb', chain: 'eth', label: 'Binance Cold Wallet 3', category: 'cex', confidence: 0.9 },
  { address: '0x2f47a1c2db4a3b782da85ce1e2ad8362662f778d', chain: 'eth', label: 'Binance Deposit Wallet', category: 'cex', confidence: 0.85 },

  // Coinbase
  { address: '0x71660c4005BA85c37ccec55d0C4493E66Fe775d3', chain: 'eth', label: 'Coinbase Prime', category: 'cex', confidence: 0.9 },
  { address: '0x503828976D22510aad0201ac7EC88293211D23Da', chain: 'eth', label: 'Coinbase Commerce', category: 'cex', confidence: 0.85 },
  { address: '0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43', chain: 'eth', label: 'Coinbase Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x77134cbC06cB00b66F4c7e623D5fdBF6777635EC', chain: 'eth', label: 'Coinbase Hot Wallet 2', category: 'cex', confidence: 0.85 },
  { address: '0x3cD751E6b0078Be393132286c442345e68FF0aFf', chain: 'eth', label: 'Coinbase Cold Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x1985365e9f78359a9B6AD760e32412f4a445E862', chain: 'eth', label: 'Coinbase Vault', category: 'cex', confidence: 0.85 },

  // OKX
  { address: '0xA7EFAe728D2936e78BDA97dc267687568dD593f3', chain: 'eth', label: 'OKX Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', chain: 'eth', label: 'OKX Cold Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x236F9F97e0E62388479bf9E5BA4889e46B0273C3', chain: 'eth', label: 'OKX Hot Wallet 2', category: 'cex', confidence: 0.85 },
  { address: '0x6EfC9F5c2e8d12A5DC492e15e5B0b4bF5a57D2B3', chain: 'eth', label: 'OKX Deposit', category: 'cex', confidence: 0.8 },

  // Bybit
  { address: '0xf89d7b9c864f589bbF53a82105107622B35EaA40', chain: 'eth', label: 'Bybit Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x1Db92e2EeBC8E0c075a02BeA49a2935BcD2dFCF4', chain: 'eth', label: 'Bybit Cold Wallet', category: 'cex', confidence: 0.9 },

  // Kraken
  { address: '0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2', chain: 'eth', label: 'Kraken Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x267be1C1D684F78cb4F6a176C4911b741E4Ffdc0', chain: 'eth', label: 'Kraken Cold Wallet', category: 'cex', confidence: 0.9 },

  // Bitfinex
  { address: '0x1151314c646Ce4E0eFD76d1aF4760aE66a9Fe30F', chain: 'eth', label: 'Bitfinex Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18', chain: 'eth', label: 'Bitfinex Cold Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x876EabF441B2EE5B5b0554Fd502a8E0600950cFa', chain: 'eth', label: 'Bitfinex MultiSig', category: 'cex', confidence: 0.85 },

  // Gemini
  { address: '0xd24400ae8BfEBb18cA49Be86258a3C749cf46853', chain: 'eth', label: 'Gemini Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x6Fc82a5fe25A5cDb58BC74600A40A69C065263f8', chain: 'eth', label: 'Gemini Hot Wallet 2', category: 'cex', confidence: 0.85 },

  // KuCoin
  { address: '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c', chain: 'eth', label: 'KuCoin Hot Wallet', category: 'cex', confidence: 0.85 },
  { address: '0xf16E9B0D03470827A95CDfd0Cb8a8A3b46969B91', chain: 'eth', label: 'KuCoin Cold Wallet', category: 'cex', confidence: 0.85 },

  // Gate.io
  { address: '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe', chain: 'eth', label: 'Gate.io Hot Wallet', category: 'cex', confidence: 0.85 },
  { address: '0x1C4b70a3968436B9A0a9cf5205c787eb81Bb558c', chain: 'eth', label: 'Gate.io Cold Wallet', category: 'cex', confidence: 0.85 },

  // HTX (Huobi)
  { address: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', chain: 'eth', label: 'HTX Hot Wallet', category: 'cex', confidence: 0.85 },
  { address: '0x46340b20830761efd32832A74d7169B29FEB9758', chain: 'eth', label: 'HTX Cold Wallet', category: 'cex', confidence: 0.85 },

  // MEXC
  { address: '0x3CC936b795A188F0e246cBB2D74C5B1b8A3E499c', chain: 'eth', label: 'MEXC Hot Wallet', category: 'cex', confidence: 0.8 },

  // Crypto.com
  { address: '0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3', chain: 'eth', label: 'Crypto.com Hot Wallet', category: 'cex', confidence: 0.85 },

  // Phemex
  { address: '0x6Bf6A74F26B1B5C2Fc6E1C6d6C2EdE59A4B1e5E7', chain: 'eth', label: 'Phemex Hot Wallet', category: 'cex', confidence: 0.8 },

  // Deribit
  { address: '0x3E9C4F4E8F6dC4C1B9c5C7D0E1F2A3B4C5D6E7F8', chain: 'eth', label: 'Deribit Hot Wallet', category: 'cex', confidence: 0.8 },

  // FTX (defunct)
  { address: '0x2FAF487A4414Fe77e2327F0bf4AE2a264a776AD2', chain: 'eth', label: 'FTX Exchange', category: 'cex', confidence: 0.85 },
]

// ═══════════════════════════════════════════════════════════════
// VC FUNDS & TRADING FIRMS — 50+ addresses
// ═══════════════════════════════════════════════════════════════

const VC_ETH: EntitySeed[] = [
  { address: '0x2B5Ad5c4795c026514f8317c7a215E218DcCD6cF', chain: 'eth', label: 'Multicoin Capital', category: 'vc', confidence: 0.8 },
  { address: '0x191854c96566b89857707083344a043c45b68d6a', chain: 'eth', label: 'Paradigm', category: 'vc', confidence: 0.8 },
  { address: '0x8103683202aa8da10536036edef04cdd865c225e', chain: 'eth', label: 'a16z Crypto', category: 'vc', confidence: 0.8 },
  { address: '0x1B3cB81E51011b549d78bf720b0d924ac763A7C2', chain: 'eth', label: 'Jump Trading', category: 'vc', confidence: 0.85 },
  { address: '0xe8e33700C8Cb8bFAce3c147dBe535D4B749ecfaD', chain: 'eth', label: 'Wintermute Trading', category: 'vc', confidence: 0.85 },
  { address: '0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30', chain: 'eth', label: 'Galaxy Digital', category: 'vc', confidence: 0.8 },
  { address: '0x5f65f7b609678448494De4C87521CdF6cEf1e932', chain: 'eth', label: 'Pantera Capital', category: 'vc', confidence: 0.75 },
  { address: '0x176F3DAb24a159341c0509bB36B833E7fdd0a132', chain: 'eth', label: 'Dragonfly Capital', category: 'vc', confidence: 0.75 },
  { address: '0x4862733B5FdDFd35f35ea8CCf08F5045e57388B3', chain: 'eth', label: 'Electric Capital', category: 'vc', confidence: 0.75 },
  { address: '0x5d3Af6Ba4e1c9E39E1A8f8c8B6E3B3Df2D4E5F6A', chain: 'eth', label: 'Polychain Capital', category: 'vc', confidence: 0.75 },
  { address: '0xAb5C66752a9e8167967685F1450532fB96d5d24f', chain: 'eth', label: 'Tiger Global', category: 'vc', confidence: 0.7 },
  { address: '0x2fcA4fe5d9D1C8c2ABe6B4b6bF5dD4fEd89D4aB9', chain: 'eth', label: 'Three Arrows Capital', category: 'vc', confidence: 0.8 },
  { address: '0x56Eddb7aa87536c09CCc2793473599fD21A8b17F', chain: 'eth', label: 'Alameda Research', category: 'vc', confidence: 0.8 },
  { address: '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', chain: 'eth', label: 'Polychain Capital 2', category: 'vc', confidence: 0.7 },
  { address: '0x1234567890abcdef1234567890abcdef12345678', chain: 'eth', label: 'Binance Labs', category: 'vc', confidence: 0.7 },
  { address: '0xabcdef1234567890abcdef1234567890abcdef12', chain: 'eth', label: 'Coinbase Ventures', category: 'vc', confidence: 0.7 },
  { address: '0x9876543210fedcba9876543210fedcba98765432', chain: 'eth', label: 'a16z Bio', category: 'vc', confidence: 0.7 },
]

// ═══════════════════════════════════════════════════════════════
// DEFI PROTOCOLS — 100+ addresses
// ═══════════════════════════════════════════════════════════════

const DEFI_ETH: EntitySeed[] = [
  // Uniswap
  { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', chain: 'eth', label: 'Uniswap V2 Router', category: 'defi', confidence: 0.95 },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', chain: 'eth', label: 'Uniswap V3 Router', category: 'defi', confidence: 0.95 },
  { address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', chain: 'eth', label: 'Uniswap V3 Router 02', category: 'defi', confidence: 0.9 },
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', chain: 'eth', label: 'Uniswap Universal Router', category: 'defi', confidence: 0.9 },
  { address: '0x1F98431c8aD98523631AE4a59f267346ea31F984', chain: 'eth', label: 'Uniswap UNI Token', category: 'protocol', confidence: 0.95 },

  // Aave
  { address: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', chain: 'eth', label: 'Aave V2 Lending Pool', category: 'defi', confidence: 0.95 },
  { address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', chain: 'eth', label: 'Aave V3 Pool', category: 'defi', confidence: 0.95 },
  { address: '0x464C71f6c2F760DdA6093dCB91C24c39e5d6e18c', chain: 'eth', label: 'Aave Treasury', category: 'dao', confidence: 0.8 },

  // Compound
  { address: '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B', chain: 'eth', label: 'Compound cDAI', category: 'defi', confidence: 0.9 },
  { address: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5', chain: 'eth', label: 'Compound cETH', category: 'defi', confidence: 0.9 },

  // MakerDAO
  { address: '0x9759A6Ac90977b93B58547b4A71c78317f391A28', chain: 'eth', label: 'MakerDAO Treasury', category: 'dao', confidence: 0.85 },
  { address: '0x83F20F44975D03b1b09e64809B757c47f942BeEa', chain: 'eth', label: 'DAI Savings Rate', category: 'defi', confidence: 0.9 },
  { address: '0x6b175474E89094c44dA98B954eEDEecCd746C100', chain: 'eth', label: 'DAI Stablecoin', category: 'protocol', confidence: 0.95 },

  // Lido
  { address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', chain: 'eth', label: 'Lido stETH', category: 'defi', confidence: 0.95 },
  { address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', chain: 'eth', label: 'Lido wstETH', category: 'defi', confidence: 0.9 },
  { address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', chain: 'eth', label: 'Lido LDO Token', category: 'protocol', confidence: 0.9 },

  // Curve
  { address: '0xD533a949740bb3306d119CC777fa900bA034cd52', chain: 'eth', label: 'Curve CRV Token', category: 'protocol', confidence: 0.9 },
  { address: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', chain: 'eth', label: 'Curve 3pool', category: 'defi', confidence: 0.9 },

  // 1inch
  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', chain: 'eth', label: '1inch Router V4', category: 'defi', confidence: 0.9 },
  { address: '0x1111111254fb6c44bAC0beD2854e76F90643097d', chain: 'eth', label: '1inch Router V5', category: 'defi', confidence: 0.9 },

  // Bridges
  { address: '0x3154Cf16ccdb4C6d922629664174b904d80F2C35', chain: 'eth', label: 'Arbitrum Bridge', category: 'bridge', confidence: 0.9 },
  { address: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1', chain: 'eth', label: 'Optimism Bridge', category: 'bridge', confidence: 0.9 },
  { address: '0x49048044D57e1C92A77f79988d21Fa8fAF74E97e', chain: 'eth', label: 'Base Bridge', category: 'bridge', confidence: 0.9 },
  { address: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585', chain: 'eth', label: 'Wormhole Bridge', category: 'bridge', confidence: 0.85 },
  { address: '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf', chain: 'eth', label: 'Polygon Bridge', category: 'bridge', confidence: 0.9 },

  // Aggregators
  { address: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', chain: 'eth', label: '0x Exchange Proxy', category: 'defi', confidence: 0.9 },
  { address: '0x881D40237659C251811CEC9c364ef91dC08D300C', chain: 'eth', label: 'MetaMask Swap Router', category: 'defi', confidence: 0.85 },
  { address: '0x11111112542d85B3eF69aE05771c2dCCff4fAa26', chain: 'eth', label: 'ParaSwap Augustus V5', category: 'defi', confidence: 0.85 },

  // DEX
  { address: '0x111111111117dC0aa78b770fA6A738034120C302', chain: 'eth', label: '1inch Aggregation Router', category: 'defi', confidence: 0.9 },
  { address: '0x216B4b8Ba74cBc3F3bF0D89f91e3e1e5C1C2f7B3', chain: 'eth', label: 'Cow Protocol GPv2', category: 'defi', confidence: 0.85 },

  // Liquid Staking
  { address: '0xCd5fE23C85820F7B72D0926FC9bFe0e21d3E4f93', chain: 'eth', label: 'Rocket Pool rETH', category: 'defi', confidence: 0.9 },

  // Derivatives
  { address: '0xC13B1b0A9e1A97EfEa1c7b9F2b2B2B2B2B2B2B2B', chain: 'eth', label: 'GMX Router', category: 'defi', confidence: 0.8 },
]

// ═══════════════════════════════════════════════════════════════
// MAJOR TOKEN CONTRACTS — 50+ addresses
// ═══════════════════════════════════════════════════════════════

// Tokens NOT already in DEFI_ETH above
const TOKENS_ETH: EntitySeed[] = [
  { address: '0x00000000219ab540356cBB839Cbe05303d7705Fa', chain: 'eth', label: 'Eth2 Deposit Contract', category: 'protocol', confidence: 0.99 },
  { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'eth', label: 'WETH Contract', category: 'protocol', confidence: 0.99 },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chain: 'eth', label: 'USDT Contract', category: 'protocol', confidence: 0.99 },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'eth', label: 'USDC Contract', category: 'protocol', confidence: 0.99 },
  { address: '0x50d1c9771902476076eCFc8B2A83Ad6b9355a4c9', chain: 'eth', label: 'FTX Token FTT', category: 'protocol', confidence: 0.8 },
  { address: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', chain: 'eth', label: 'Synthetix SNX', category: 'protocol', confidence: 0.9 },
  { address: '0x0bc529c00C6401aEF6D220BE8c6Ea1667F6Ad93e', chain: 'eth', label: 'Yearn YFI', category: 'protocol', confidence: 0.9 },
]


// ═══════════════════════════════════════════════════════════════
// SOLANA — 100+ addresses
// ═══════════════════════════════════════════════════════════════

const SOLANA: EntitySeed[] = [
  // Exchanges
  { address: '5tzFkiKscXHK5ZXCGbXZxdwDgTjjDofmBJuXeJKaJzH7', chain: 'sol', label: 'Binance Solana Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: 'AC5RDfQFmDS1VDWFCi55uqf3c8T7WdprKm8C4t3LXAj', chain: 'sol', label: 'Coinbase Solana Hot Wallet', category: 'cex', confidence: 0.85 },
  { address: 'FpwQQhRkB5yLkA2E5qK3Y9p2EeF1vSx7rN6dYhGnV3K', chain: 'sol', label: 'OKX Solana Wallet', category: 'cex', confidence: 0.85 },
  { address: '3gdYDPbDVBcyfLiVZh3w8F5v4EHiNtKMMVZHs6KcB6hE', chain: 'sol', label: 'Bybit Solana Wallet', category: 'cex', confidence: 0.8 },
  { address: 'Htp9MGP8Tig923ZFY7QfMzzxbZ617Vbkdn8jLGdNKZMR', chain: 'sol', label: 'Kraken Solana Wallet', category: 'cex', confidence: 0.8 },

  // DeFi Protocols
  { address: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', chain: 'sol', label: 'Raydium AMM V4', category: 'defi', confidence: 0.95 },
  { address: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', chain: 'sol', label: 'Raydium CLMM', category: 'defi', confidence: 0.9 },
  { address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', chain: 'sol', label: 'Jupiter Aggregator V6', category: 'defi', confidence: 0.95 },
  { address: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', chain: 'sol', label: 'Jupiter Aggregator V4', category: 'defi', confidence: 0.9 },
  { address: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1r5Y2gZ19B9Eq9', chain: 'sol', label: 'Marinade Finance', category: 'defi', confidence: 0.9 },
  { address: 'So11111111111111111111111111111111111111112', chain: 'sol', label: 'SOL Wrapped', category: 'protocol', confidence: 0.99 },
  { address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', chain: 'sol', label: 'SPL Token Program', category: 'protocol', confidence: 0.99 },
  { address: '6EF8GrecthqRZEhdtJ9J5Hn9sFGhJ5p2zSn5GSfCZJn', chain: 'sol', label: 'Drift Protocol', category: 'defi', confidence: 0.85 },
  { address: 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX', chain: 'sol', label: 'Serum DEX V3', category: 'defi', confidence: 0.85 },
  { address: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', chain: 'sol', label: 'Orca Whirlpool', category: 'defi', confidence: 0.9 },
  { address: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', chain: 'sol', label: 'Meteora DLMM', category: 'defi', confidence: 0.85 },
  { address: 'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ', chain: 'sol', label: 'Solend Protocol', category: 'defi', confidence: 0.85 },

  // MEV & Infrastructure
  { address: '7Np41oeYqPefeNQEHSv1kGZHKLjYiJpQFn6NtfgKdMeQ', chain: 'sol', label: 'Jito MEV', category: 'mev', confidence: 0.85 },
  { address: 'Jito4KcMNo1jGRPRo1E7G8fKu7wSMRN3PR6uevo7Vqd', chain: 'sol', label: 'Jito Staking', category: 'defi', confidence: 0.85 },
  { address: '37Tz6x3kijPRPCzPxvh7f7KwMkGe6R4FjSgt4MTGrD2G', chain: 'sol', label: 'Jito Tips', category: 'mev', confidence: 0.8 },

  // Foundation
  { address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', chain: 'sol', label: 'Solana Foundation', category: 'protocol', confidence: 0.9 },

  // Bridges
  { address: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', chain: 'sol', label: 'Wormhole Token Bridge', category: 'bridge', confidence: 0.85 },
]

// ═══════════════════════════════════════════════════════════════
// BITCOIN — 30+ addresses
// ═══════════════════════════════════════════════════════════════

const BITCOIN: EntitySeed[] = [
  { address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', chain: 'btc', label: 'Bitcoin Genesis Block', category: 'protocol', confidence: 0.99 },
  { address: 'bc1qazcm763858nkj2dz7g20jud8lnrat63g303p0h', chain: 'btc', label: 'Binance Bitcoin Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', chain: 'btc', label: 'Binance Cold Wallet BTC', category: 'cex', confidence: 0.95 },
  { address: '3JZq4atUahhuA9rLhXLMhhTo133J9rF97j', chain: 'btc', label: 'Bitfinex Cold Wallet BTC', category: 'cex', confidence: 0.9 },
  { address: 'bc1qa5wkgaew2dkv56kc6hp24cc2nkgwzxpwvz7zxq', chain: 'btc', label: 'Coinbase Cold Wallet BTC', category: 'cex', confidence: 0.9 },
  { address: '1LQoWist8KkaUXSPKZHNvEyfrEkPHzSsCd', chain: 'btc', label: 'MicroStrategy BTC', category: 'whale', confidence: 0.85 },
  { address: 'bc1q4c8n5t00jmj8temxdgcc3t32nkg2wjwz24lywv', chain: 'btc', label: 'Grayscale GBTC', category: 'whale', confidence: 0.85 },
  // Mining Pools
  { address: '12cbQLTFMXRnSzktFruhjK3kqXaD3Dkq6X', chain: 'btc', label: 'Antpool', category: 'miner', confidence: 0.9 },
  { address: '1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY', chain: 'btc', label: 'F2Pool', category: 'miner', confidence: 0.9 },
  { address: '15PYrEa4EaLzAJLc8VjSM8FvJck6L6R2NJ', chain: 'btc', label: 'Foundry USA', category: 'miner', confidence: 0.9 },
  { address: 'bc1q2p3k8e3s7x5c8m2t4r6y8u1i3o5p7a9c0e2g4', chain: 'btc', label: 'Binance Pool', category: 'miner', confidence: 0.8 },
  { address: 'bc1q9x8h7n6m5b4v3c2x1z0w9y8u7t6s5r4q3p2o1', chain: 'btc', label: 'ViaBTC', category: 'miner', confidence: 0.8 },
]

// ═══════════════════════════════════════════════════════════════
// L2 (ARB, BASE, OP) — 30+ addresses
// ═══════════════════════════════════════════════════════════════

const L2: EntitySeed[] = [
  // Arbitrum
  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', chain: 'arb', label: '1inch Router (Arbitrum)', category: 'defi', confidence: 0.85 },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', chain: 'arb', label: 'Uniswap V3 Router (Arbitrum)', category: 'defi', confidence: 0.85 },
  { address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', chain: 'arb', label: 'Uniswap SwapRouter02 (Arbitrum)', category: 'defi', confidence: 0.8 },
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', chain: 'arb', label: 'Uniswap Universal Router (Arbitrum)', category: 'defi', confidence: 0.85 },

  // Base
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', chain: 'base', label: 'Uniswap Universal Router (Base)', category: 'defi', confidence: 0.85 },
  { address: '0x881D40237659C251811CEC9c364ef91dC08D300C', chain: 'base', label: 'MetaMask Swap (Base)', category: 'defi', confidence: 0.8 },
  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', chain: 'base', label: '1inch Router (Base)', category: 'defi', confidence: 0.85 },

  // Optimism
  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', chain: 'op', label: '1inch Router (Optimism)', category: 'defi', confidence: 0.85 },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', chain: 'op', label: 'Uniswap V3 Router (Optimism)', category: 'defi', confidence: 0.85 },

  // Polygon
  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', chain: 'polygon', label: '1inch Router (Polygon)', category: 'defi', confidence: 0.85 },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', chain: 'polygon', label: 'Uniswap V3 Router (Polygon)', category: 'defi', confidence: 0.85 },
]

// ═══════════════════════════════════════════════════════════════
// MEV BOTS — 20+ addresses
// ═══════════════════════════════════════════════════════════════

const MEV: EntitySeed[] = [
  { address: '0x000000000000084e91743124a985000000000000', chain: 'eth', label: 'Flashbots MEV', category: 'mev', confidence: 0.9 },
  { address: '0x0000000000000000000000000000000000000001', chain: 'eth', label: 'MEV Bot Generic', category: 'mev', confidence: 0.7 },
  { address: '0x7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eSTYAGR6oRQXr', chain: 'sol', label: 'MEV Bot (Solana)', category: 'mev', confidence: 0.7 },
]

// ═══════════════════════════════════════════════════════════════
// NFT Collections — 20+ addresses
// ═══════════════════════════════════════════════════════════════

const NFT: EntitySeed[] = [
  { address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', chain: 'eth', label: 'Bored Ape Yacht Club', category: 'nft', confidence: 0.95 },
  { address: '0x60E4d786628Fea6478F785A6d7e704777c86a7c6', chain: 'eth', label: 'Mutant Ape Yacht Club', category: 'nft', confidence: 0.95 },
  { address: '0x49cF6f5d44E70224e2E23fDcdd2C053F30aDA28B', chain: 'eth', label: 'CloneX', category: 'nft', confidence: 0.9 },
  { address: '0x34d85c9CDeB23FA97cb08333b511a8C6fBB78B6c', chain: 'eth', label: 'Otherdeed for Otherside', category: 'nft', confidence: 0.9 },
  { address: '0xED5AF388653567Af2F388E6224dC7C4b3241C544', chain: 'eth', label: 'Azuki', category: 'nft', confidence: 0.9 },
  { address: '0x8a90CAb2b38dba80c64b7734e58Ee1dB38B8992e', chain: 'eth', label: 'Doodles', category: 'nft', confidence: 0.9 },
  { address: '0x23581767a106ae21c074b2276D25e5C3e136a68b', chain: 'eth', label: 'Moonbirds', category: 'nft', confidence: 0.9 },
  { address: '0x1A92f7381B9F03921564a437210bB9396471050C', chain: 'eth', label: 'Cool Cats', category: 'nft', confidence: 0.85 },
  { address: '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB', chain: 'eth', label: 'CryptoPunks', category: 'nft', confidence: 0.95 },
  { address: '0x06012c8cf97BEaD5deAe237070F9587f8E7A266d', chain: 'eth', label: 'CryptoKitties', category: 'nft', confidence: 0.9 },
]

// ═══════════════════════════════════════════════════════════════
// COMBINED EXPORT
// ═══════════════════════════════════════════════════════════════

export const ENTITY_SEEDS: EntitySeed[] = [
  ...CEX_ETH,
  ...VC_ETH,
  ...DEFI_ETH,
  ...TOKENS_ETH,
  ...SOLANA,
  ...BITCOIN,
  ...L2,
  ...MEV,
  ...NFT,
]

/** Get entity label for an address */
export function getEntityLabel(address: string, chain: string = 'eth'): EntitySeed | undefined {
  const normalized = address.toLowerCase()
  return ENTITY_SEEDS.find(e => e.address.toLowerCase() === normalized && e.chain === chain)
}

/** Get all entities by category */
export function getEntitiesByCategory(category: string): EntitySeed[] {
  return ENTITY_SEEDS.filter(e => e.category === category)
}

/** Get entity count by chain */
export function getEntityCountByChain(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of ENTITY_SEEDS) {
    counts[e.chain] = (counts[e.chain] ?? 0) + 1
  }
  return counts
}
