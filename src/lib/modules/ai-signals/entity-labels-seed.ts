// ─────────────────────────────────────────────────────────────
// Entity Label Seed Data
// Known entities from public sources (Dune Analytics, community lists)
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
  // Exchanges
  { address: '0x28C6c06298d514Db089934071355E5743bf21d60', chain: 'eth', label: 'Binance Hot Wallet', category: 'cex', confidence: 0.95 },
  { address: '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549', chain: 'eth', label: 'Binance Cold Wallet', category: 'cex', confidence: 0.95 },
  { address: '0xA7EFAe728D2936e78BDA97dc267687568dD593f3', chain: 'eth', label: 'OKX Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', chain: 'eth', label: 'OKX Cold Wallet', category: 'cex', confidence: 0.9 },
  { address: '0x2FAF487A4414Fe77e2327F0bf4AE2a264a776AD2', chain: 'eth', label: 'FTX Exchange', category: 'cex', confidence: 0.85 },
  { address: '0x71660c4005BA85c37ccec55d0C4493E66Fe775d3', chain: 'eth', label: 'Coinbase Prime', category: 'cex', confidence: 0.9 },
  { address: '0x503828976D22510aad0201ac7EC88293211D23Da', chain: 'eth', label: 'Coinbase Commerce', category: 'cex', confidence: 0.85 },

  // VC Funds
  { address: '0x2B5Ad5c4795c026514f8317c7a215E218DcCD6cF', chain: 'eth', label: 'Multicoin Capital', category: 'vc', confidence: 0.8 },
  { address: '0x191854c96566b89857707083344a043c45b68d6a', chain: 'eth', label: 'Paradigm', category: 'vc', confidence: 0.8 },
  { address: '0x8103683202aa8da10536036edef04cdd865c225e', chain: 'eth', label: 'a16z Crypto', category: 'vc', confidence: 0.8 },

  // DeFi Protocols
  { address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', chain: 'eth', label: 'Binance: BSC Token Hub', category: 'defi', confidence: 0.9 },
  { address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', chain: 'eth', label: 'Binance: Binance-Peg Tokens', category: 'defi', confidence: 0.9 },
  { address: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', chain: 'eth', label: '0x Exchange Proxy', category: 'defi', confidence: 0.9 },
  { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', chain: 'eth', label: 'Uniswap V2 Router', category: 'defi', confidence: 0.95 },
  { address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', chain: 'eth', label: 'Uniswap V3 Router', category: 'defi', confidence: 0.95 },
  { address: '0x1111111254EEB25477B68fb85Ed929f73A960582', chain: 'eth', label: '1inch Router', category: 'defi', confidence: 0.9 },
  { address: '0x881D40237659C251811CEC9c364ef91dC08D300C', chain: 'eth', label: 'MetaMask Swap Router', category: 'defi', confidence: 0.85 },

  // Known Whales (public knowledge)
  { address: '0x00000000219ab540356cBB839Cbe05303d7705Fa', chain: 'eth', label: 'Eth2 Deposit Contract', category: 'protocol', confidence: 0.99 },
  { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'eth', label: 'WETH Contract', category: 'protocol', confidence: 0.99 },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chain: 'eth', label: 'USDT Contract', category: 'protocol', confidence: 0.99 },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'eth', label: 'USDC Contract', category: 'protocol', confidence: 0.99 },

  // Solana
  { address: '5tzFkiKscXHK5ZXCGbXZxdwDgTjjDofmBJuXeJKaJzH7', chain: 'sol', label: 'Binance Solana Hot Wallet', category: 'cex', confidence: 0.9 },
  { address: 'AC5RDfQFmDS1VDWFCi55uqf3c8T7WdprKm8C4t3LXAj', chain: 'sol', label: 'Coinbase Solana Hot Wallet', category: 'cex', confidence: 0.85 },
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
