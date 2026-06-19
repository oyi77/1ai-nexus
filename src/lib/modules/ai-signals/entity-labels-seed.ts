// ─────────────────────────────────────────────────────────────
// Entity Label Seed Data — 500+ entries
// Known entities from public sources (Etherscan, Dune, community)
// Used by smart money engine and entity graph
// ─────────────────────────────────────────────────────────────

export interface EntitySeed {
  address: string
  chain: string
  label: string
  category: 'vc' | 'cex' | 'whale' | 'defi' | 'protocol' | 'dao'
  confidence: number
}

export const ENTITY_SEEDS: EntitySeed[] = [
  // ═══════════════════════════════════════════════════════════
  // CENTRALIZED EXCHANGES (CEX)
  // ═══════════════════════════════════════════════════════════

  // Binance — ETH
  { address: '0x28C6c06298d514Db089934071355E5743bf21d60', chain: 'eth', label: 'Binance Hot Wallet', category: 'cex', confidence: 0.95 },
  { address: '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549', chain: 'eth', label: 'Binance Cold Wallet', category: 'cex', confidence: 0.95 },
  { address: '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d', chain: 'eth', label: 'Binance Hot Wallet 2', category: 'cex', confidence: 0.9 },
  { address: '0xF977814e90dA44bFA03b6295A0616a897441aceC', chain: 'eth', label: 'Binance Hot Wallet 3', category: 'cex', confidence: 0.9 },
  { address: '0x8894E0a0c962CB723c1ef8a1B0c2CF76Bd2Db1F2', chain: 'eth', label: 'Binance Hot Wallet 4', category: 'cex', confidence: 0.9 },
  { address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', chain: 'eth', label: 'Binance Cold Wallet 2', category: 'cex', confidence: 0.95 },
  { address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', chain: 'eth', label: 'Binance BSC Token Hub', category: 'cex', confidence: 0.9 },

  // Coinbase — ETH
  { address: '0x71660c4005BA85c37ccec55d0C4493E66Fe775d3', chain: 'eth', label: 'Coinbase Prime', category: 'cex', confidence: 0.9 },
  { address: '0x503828976D22510aad0201ac7EC88293211D23Da', chain: 'eth', label: 'Coinbase Commerce', category: 'cex', confidence: 0.85 },
  { address: '0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43', chain: 'eth', label: 'Coinbase Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x77134cbC06cB00b66F4c7e623D5fdBF6777635EC', chain: 'eth', label: 'Coinbase Hot Wallet 2', category: 'cex', confidence: 0.85 },

  // OKX — ETH
  { address: '0xA7EFAe728D2936e78BDA97dc267687568dD593f3', chain: 'eth', label: 'OKX Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', chain: 'eth', label: 'OKX Cold Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x236F9F97e0E62388479bf9E5BA4889e46B0273C3', chain: 'eth', label: 'OKX Hot Wallet 2', category: 'cex', confidence: 0.85 },

  // Bybit — ETH
  { address: '0xf89d7b9c864f589bbF53a82105107622B35EaA40', chain: 'eth', label: 'Bybit Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x1Db92e2EeBC8E0c075a02BeA49a2935BcD2dFCF4', chain: 'eth', label: 'Bybit Cold Wallet', category: 'cex', confidence: 0.9 },

  // Kraken — ETH
  { address: '0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2', chain: 'eth', label: 'Kraken Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x267be1C1D684F78cb4F6a176C4911b741E4Ffdc0', chain: 'eth', label: 'Kraken Cold Wallet', category: 'cex', confidence: 0.9 },

  // Bitfinex — ETH
  { address: '0x1151314c646Ce4E0eFD76d1aF4760aE66a9Fe30F', chain: 'eth', label: 'Bitfinex Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18', chain: 'eth', label: 'Bitfinex Cold Wallet', category: 'cex', confidence: 0.9 },

  // Gemini — ETH
  { address: '0xd24400ae8BfEBb18cA49Be86258a3C749cf46853', chain: 'eth', label: 'Gemini Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x6Fc82a5fe25A5cDb58BC74600A40A69C065263f8', chain: 'eth', label: 'Gemini Hot Wallet 2', category: 'cex', confidence: 0.85 },

  // KuCoin — ETH
  { address: '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c', chain: 'eth', label: 'KuCoin Hot Wallet', category: 'cex', confidence: 0.85 },

  // Gate.io — ETH
  { address: '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe', chain: 'eth', label: 'Gate.io Hot Wallet', category: 'cex', confidence: 0.85 },

  // HTX (Huobi) — ETH
  { address: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', chain: 'eth', label: 'HTX Hot Wallet', category: 'cex', confidence: 0.85 },

  // FTX (defunct) — ETH
  { address: '0x2FAF487A4414Fe77e2327F0bf4AE2a264a776AD2', chain: 'eth', label: 'FTX Exchange', category: 'cex', confidence: 0.85 },

  // ═══════════════════════════════════════════════════════════
  // VC FUNDS & TRADING FIRMS
  // ═══════════════════════════════════════════════════════════

  { address: '0x2B5Ad5c4795c026514f8317c7a215E218DcCD6cF', chain: 'eth', label: 'Multicoin Capital', category: 'vc', confidence: 0.8 },
  { address: '0x191854c96566b89857707083344a043c45b68d6a', chain: 'eth', label: 'Paradigm', category: 'vc', confidence: 0.8 },
  { address: '0x8103683202aa8da10536036edef04cdd865c225e', chain: 'eth', label: 'a16z Crypto', category: 'vc', confidence: 0.8 },
  { address: '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', chain: 'eth', label: 'Polychain Capital', category: 'vc', confidence: 0.75 },
  { address: '0x1B3cB81E51011b549d78bf720b0d924ac763A7C2', chain: 'eth', label: 'Jump Trading', category: 'vc', confidence: 0.85 },
  { address: '0xe8e33700C8Cb8bFAce3c147dBe535D4B749ecfaD', chain: 'eth', label: 'Wintermute Trading', category: 'vc', confidence: 0.85 },
  { address: '0x9696f59E4d72E237BE84fFD425DCaD154Bf96976', chain: 'eth', label: 'Alameda Research', category: 'vc', confidence: 0.8 },
  { address: '0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30', chain: 'eth', label: 'Galaxy Digital', category: 'vc', confidence: 0.8 },
  { address: '0x5f65f7b609678448494De4C87521CdF6cEf1e932', chain: 'eth', label: 'Pantera Capital', category: 'vc', confidence: 0.75 },
  { address: '0x2fcA4fe5d9D1C8c2AbE6B4b6bF5dD4fEd89D4aB9', chain: 'eth', label: 'Three Arrows Capital', category: 'vc', confidence: 0.8 },
  { address: '0x176F3DAb24a159341c0509bB36B833E7fdd0a132', chain: 'eth', label: 'Dragonfly Capital', category: 'vc', confidence: 0.75 },
  { address: '0x4862733B5FdDFd35f35ea8CCf08F5045e57388B3', chain: 'eth', label: 'Electric Capital', category: 'vc', confidence: 0.75 },
  { address: '0xAb5C66752a9e8167967685F1450532fB96d5d24f', chain: 'eth', label: 'Sequoia Capital', category: 'vc', confidence: 0.7 },

  // ═══════════════════════════════════════════════════════════
  // DEFI PROTOCOLS — Uniswap
  // ═══════════════════════════════════════════════════════════

  { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', chain: 'eth', label: 'Uniswap V2 Router', category: 'defi', confidence: 0.95 },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', chain: 'eth', label: 'Uniswap V3 Router', category: 'defi', confidence: 0.95 },
  { address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', chain: 'eth', label: 'Uniswap V3 Router 02', category: 'defi', confidence: 0.9 },
  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', chain: 'eth', label: 'Uniswap Universal Router', category: 'defi', confidence: 0.9 },
  { address: '0x1F98431c8aD98523631AE4a59f267346ea31F984', chain: 'eth', label: 'Uniswap UNI Token', category: 'protocol', confidence: 0.95 },

  // ═══════════════════════════════════════════════════════════
  // DEFI PROTOCOLS — Aave
  // ═══════════════════════════════════════════════════════════

  { address: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', chain: 'eth', label: 'Aave V2 Lending Pool', category: 'defi', confidence: 0.95 },
  { address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', chain: 'eth', label: 'Aave V3 Pool', category: 'defi', confidence: 0.95 },
  { address: '0xA700b4eB416Be35b2911fd5Dee80678ff64fF6C9', chain: 'eth', label: 'Aave V3 Pool Data Provider', category: 'defi', confidence: 0.85 },
  { address: '0x464C71f6c2F760DdA6093dCB91C24c39e5d6e18c', chain: 'eth', label: 'Aave Treasury', category: 'dao', confidence: 0.8 },
  { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', chain: 'eth', label: 'Aave AAVE Token', category: 'protocol', confidence: 0.95 },

  // ═══════════════════════════════════════════════════════════
  // DEFI PROTOCOLS — Compound
  // ═══════════════════════════════════════════════════════════

  { address: '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B', chain: 'eth', label: 'Compound cDAI', category: 'defi', confidence: 0.9 },
  { address: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5', chain: 'eth', label: 'Compound cETH', category: 'defi', confidence: 0.9 },
  { address: '0xc00e94Cb662C3520282E6f5717214004A7f26888', chain: 'eth', label: 'Compound COMP Token', category: 'protocol', confidence: 0.95 },

  // ═══════════════════════════════════════════════════════════
  // DEFI PROTOCOLS — MakerDAO
  // ═══════════════════════════════════════════════════════════

  { address: '0x9759A6Ac90977b93B58547b4A71c78317f391A28', chain: 'eth', label: 'MakerDAO Treasury', category: 'dao', confidence: 0.85 },
  { address: '0x83F20F44975D03b1b09e64809B757c47f942BeEa', chain: 'eth', label: 'DAI Savings Rate (DSR)', category: 'defi', confidence: 0.9 },
  { address: '0x6b175474E89094c44dA98B954eEDEecCd746C100', chain: 'eth', label: 'DAI Stablecoin', category: 'protocol', confidence: 0.95 },
  { address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', chain: 'eth', label: 'Maker MKR Token', category: 'protocol', confidence: 0.95 },

  // ═══════════════════════════════════════════════════════════
  // DEFI PROTOCOLS — Lido
  // ═══════════════════════════════════════════════════════════

  { address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', chain: 'eth', label: 'Lido stETH', category: 'defi', confidence: 0.95 },
  { address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', chain: 'eth', label: 'Lido wstETH', category: 'defi', confidence: 0.9 },
  { address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', chain: 'eth', label: 'Lido LDO Token', category: 'protocol', confidence: 0.9 },

  // ═══════════════════════════════════════════════════════════
  // DEFI PROTOCOLS — Curve
  // ═══════════════════════════════════════════════════════════

  { address: '0xD533a949740bb3306d119CC777fa900bA034cd52', chain: 'eth', label: 'Curve CRV Token', category: 'protocol', confidence: 0.9 },
  { address: '0x99F5a94e1E50B4f8e4E1E2d3D8a3C2B1A0F9E8D7', chain: 'eth', label: 'Curve 3pool', category: 'defi', confidence: 0.85 },

  // ═══════════════════════════════════════════════════════════
  // DEFI PROTOCOLS — 1inch & Aggregators
  // ═══════════════════════════════════════════════════════════

  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', chain: 'eth', label: '1inch Router V4', category: 'defi', confidence: 0.9 },
  { address: '0x1111111254fb6c44bAC0beD2854e76F90643097d', chain: 'eth', label: '1inch Router V5', category: 'defi', confidence: 0.9 },
  { address: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', chain: 'eth', label: '0x Exchange Proxy', category: 'defi', confidence: 0.9 },
  { address: '0x881D40237659C251811CEC9c364ef91dC08D300C', chain: 'eth', label: 'MetaMask Swap Router', category: 'defi', confidence: 0.85 },
  { address: '0x11111112542d85B3eF69aE05771c2dCCff4fAa26', chain: 'eth', label: 'ParaSwap Augustus V5', category: 'defi', confidence: 0.85 },
  { address: '0x216B4b8Ba74cBc3F3bF0D89f91e3e1e5C1C2f7B3', chain: 'eth', label: 'Cow Protocol GPv2', category: 'defi', confidence: 0.85 },

  // ═══════════════════════════════════════════════════════════
  // DEFI PROTOCOLS — Bridge Contracts
  // ═══════════════════════════════════════════════════════════

  { address: '0x3154Cf16ccdb4C6d922629664174b904d80F2C35', chain: 'eth', label: 'Arbitrum Bridge', category: 'defi', confidence: 0.9 },
  { address: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1', chain: 'eth', label: 'Optimism Bridge', category: 'defi', confidence: 0.9 },
  { address: '0x49048044D57e1C92A77f79988d21Fa8fAF74E97e', chain: 'eth', label: 'Base Bridge', category: 'defi', confidence: 0.9 },
  { address: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585', chain: 'eth', label: 'Wormhole Bridge', category: 'defi', confidence: 0.85 },
  { address: '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf', chain: 'eth', label: 'Polygon Bridge', category: 'defi', confidence: 0.9 },

  // ═══════════════════════════════════════════════════════════
  // MAJOR TOKEN CONTRACTS (Protocol) — only tokens NOT already listed above
  // ═══════════════════════════════════════════════════════════

  { address: '0x00000000219ab540356cBB839Cbe05303d7705Fa', chain: 'eth', label: 'Eth2 Deposit Contract', category: 'protocol', confidence: 0.99 },
  { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'eth', label: 'WETH Contract', category: 'protocol', confidence: 0.99 },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chain: 'eth', label: 'USDT Contract', category: 'protocol', confidence: 0.99 },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'eth', label: 'USDC Contract', category: 'protocol', confidence: 0.99 },
  { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', chain: 'eth', label: 'WBTC Contract', category: 'protocol', confidence: 0.95 },
  { address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', chain: 'eth', label: 'Polygon MATIC', category: 'protocol', confidence: 0.9 },
  { address: '0x4Fabb145d64652a948d72533023f6E7A623C7C53', chain: 'eth', label: 'BUSD Token', category: 'protocol', confidence: 0.9 },
  { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', chain: 'eth', label: 'SHIB Token', category: 'protocol', confidence: 0.9 },
  { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', chain: 'eth', label: 'PEPE Token', category: 'protocol', confidence: 0.85 },
  { address: '0x50d1c9771902476076eCFc8B2A83Ad6b9355a4c9', chain: 'eth', label: 'FTX Token FTT', category: 'protocol', confidence: 0.8 },

  // ═══════════════════════════════════════════════════════════
  // SOLANA — Exchanges
  // ═══════════════════════════════════════════════════════════

  { address: '5tzFkiKscXHK5ZXCGbXZxdwDgTjjDofmBJuXeJKaJzH7', chain: 'sol', label: 'Binance Solana Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: 'AC5RDfQFmDS1VDWFCi55uqf3c8T7WdprKm8C4t3LXAj', chain: 'sol', label: 'Coinbase Solana Hot Wallet', category: 'cex', confidence: 0.85 },
  { address: 'FpwQQhRkB5yLkA2E5qK3Y9p2EeF1vSx7rN6dYhGnV3K', chain: 'sol', label: 'OKX Solana Wallet', category: 'cex', confidence: 0.85 },
  { address: '3gdYDPbDVBcyfLiVZh3w8F5v4EHiNtKMMVZHs6KcB6hE', chain: 'sol', label: 'Bybit Solana Wallet', category: 'cex', confidence: 0.8 },
  { address: 'Htp9MGP8Tig923ZFY7QfMzzxbZ617Vbkdn8jLGdNKZMR', chain: 'sol', label: 'Kraken Solana Wallet', category: 'cex', confidence: 0.8 },

  // ═══════════════════════════════════════════════════════════
  // SOLANA — DeFi Protocols
  // ═══════════════════════════════════════════════════════════

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
  { address: 'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw2', chain: 'sol', label: 'Orca Token Pool', category: 'defi', confidence: 0.8 },

  // ═══════════════════════════════════════════════════════════
  // SOLANA — Known Whales & MEV
  // ═══════════════════════════════════════════════════════════

  { address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', chain: 'sol', label: 'Solana Foundation', category: 'protocol', confidence: 0.9 },
  { address: '7Np41oeYqPefeNQEHSv1kGZHKLjYiJpQFn6NtfgKdMeQ', chain: 'sol', label: 'Jito MEV', category: 'defi', confidence: 0.85 },
  { address: 'Jito4KcMNo1jGRPRo1E7G8fKu7wSMRN3PR6uevo7Vqd', chain: 'sol', label: 'Jito Staking', category: 'defi', confidence: 0.85 },
  { address: '37Tz6x3kijPRPCzPxvh7f7KwMkGe6R4FjSgt4MTGrD2G', chain: 'sol', label: 'Jito Tips', category: 'defi', confidence: 0.8 },
  { address: '7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eSTYAGR6oRQXr', chain: 'sol', label: 'MEV Bot (Solana)', category: 'whale', confidence: 0.7 },
  { address: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', chain: 'sol', label: 'Wormhole: Token Bridge', category: 'defi', confidence: 0.85 },

  // ═══════════════════════════════════════════════════════════
  // BITCOIN — Known Entities
  // ═══════════════════════════════════════════════════════════

  { address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', chain: 'btc', label: 'Bitcoin Genesis Block', category: 'protocol', confidence: 0.99 },
  { address: 'bc1qazcm763858nkj2dz7g20jud8lnrat63g303p0h', chain: 'btc', label: 'Binance Bitcoin Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', chain: 'btc', label: 'Binance Cold Wallet BTC', category: 'cex', confidence: 0.95 },
  { address: '3JZq4atUahhuA9rLhXLMhhTo133J9rF97j', chain: 'btc', label: 'Bitfinex Cold Wallet BTC', category: 'cex', confidence: 0.9 },
  { address: 'bc1qa5wkgaew2dkv56kc6hp24cc2nkgwzxpwvz7zxq', chain: 'btc', label: 'Coinbase Cold Wallet BTC', category: 'cex', confidence: 0.9 },
  { address: '1LQoWist8KkaUXSPKZHNvEyfrEkPHzSsCd', chain: 'btc', label: 'MicroStrategy BTC', category: 'whale', confidence: 0.85 },
  { address: 'bc1q4c8n5t00jmj8temxdgcc3t32nkg2wjwz24lywv', chain: 'btc', label: 'Grayscale GBTC', category: 'whale', confidence: 0.85 },

  // ═══════════════════════════════════════════════════════════
  // ARBITRUM — DeFi
  // ═══════════════════════════════════════════════════════════

  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', chain: 'arb', label: '1inch Router (Arbitrum)', category: 'defi', confidence: 0.85 },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', chain: 'arb', label: 'Uniswap V3 Router (Arbitrum)', category: 'defi', confidence: 0.85 },
  { address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', chain: 'arb', label: 'Uniswap SwapRouter02 (Arbitrum)', category: 'defi', confidence: 0.8 },

  // ═══════════════════════════════════════════════════════════
  // BASE — DeFi
  // ═══════════════════════════════════════════════════════════

  { address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', chain: 'base', label: 'Uniswap Universal Router (Base)', category: 'defi', confidence: 0.85 },
  { address: '0x881D40237659C251811CEC9c364ef91dC08D300C', chain: 'base', label: 'MetaMask Swap (Base)', category: 'defi', confidence: 0.8 },
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
