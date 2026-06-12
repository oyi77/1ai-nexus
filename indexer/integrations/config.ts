// ─────────────────────────────────────────────────────────────
// Centralized Configuration for External Integrations
// Single source of truth for API keys, endpoints, and availability
// ─────────────────────────────────────────────────────────────

export interface IntegrationStatus {
  name: string;
  available: boolean;
  reason?: string;
}

export interface IntegrationConfig {
  alchemy: { apiKey: string | null; networks: Record<string, string> };
  etherscan: Record<string, { apiUrl: string; apiKey: string }>;
  helius: { apiKey: string | null };
  defillama: { baseUrl: string; yieldsUrl: string }; // always available
  jupiter: { priceUrl: string }; // always available
}

const NETWORKS: Record<string, string> = {
  eth: "eth-mainnet",
  arb: "arb-mainnet",
  base: "base-mainnet",
  op: "opt-mainnet",
  polygon: "polygon-mainnet",
};

const EXPLORER_APIS: Record<string, { url: string; envKey: string }> = {
  eth: { url: "https://api.etherscan.io/api", envKey: "ETHERSCAN_API_KEY" },
  arb: { url: "https://api.arbiscan.io/api", envKey: "ARBISCAN_API_KEY" },
  base: { url: "https://api.basescan.org/api", envKey: "BASESCAN_API_KEY" },
  op: { url: "https://api-optimistic.etherscan.io/api", envKey: "OPTIMISM_ETHERSCAN_API_KEY" },
  bsc: { url: "https://api.bscscan.com/api", envKey: "BSCSCAN_API_KEY" },
  polygon: { url: "https://api.polygonscan.com/api", envKey: "POLYGONSCAN_API_KEY" },
};

function env(key: string): string | null {
  return process.env[key] || null;
}

/** Build integration config from environment */
export function buildConfig(): IntegrationConfig {
  const etherscan: Record<string, { apiUrl: string; apiKey: string }> = {};
  for (const [chain, { url, envKey }] of Object.entries(EXPLORER_APIS)) {
    const key = env(envKey);
    if (key) etherscan[chain] = { apiUrl: url, apiKey: key };
  }

  return {
    alchemy: {
      apiKey: env("ALCHEMY_API_KEY"),
      networks: NETWORKS,
    },
    etherscan,
    helius: {
      apiKey: env("HELIUS_API_KEY"),
    },
    defillama: {
      baseUrl: "https://api.llama.fi",
      yieldsUrl: "https://yields.llama.fi",
    },
    jupiter: {
      priceUrl: "https://api.jup.ag/price/v2",
    },
  };
}

/** Check which integrations are available */
export function checkAvailability(config: IntegrationConfig): IntegrationStatus[] {
  return [
    {
      name: "Alchemy",
      available: !!config.alchemy.apiKey,
      reason: config.alchemy.apiKey ? "API key configured" : "ALCHEMY_API_KEY not set",
    },
    {
      name: "Etherscan",
      available: Object.keys(config.etherscan).length > 0,
      reason:
        Object.keys(config.etherscan).length > 0
          ? `Configured for: ${Object.keys(config.etherscan).join(", ")}`
          : "No Etherscan API keys set",
    },
    {
      name: "Helius",
      available: !!config.helius.apiKey,
      reason: config.helius.apiKey ? "API key configured (enhanced Solana)" : "HELIUS_API_KEY not set (using public RPC)",
    },
    {
      name: "CEX",
      available: true,
      reason: "Free public endpoints via cex client",
    },
    {
      name: "DeFiLlama",
      available: true,
      reason: "Free, no auth needed",
    },
    {
      name: "Jupiter",
      available: true,
      reason: "Free, no auth needed",
    },
  ];
}

/** Get Alchemy RPC URL for a chain */
export function alchemyRpcUrl(config: IntegrationConfig, chain: string): string | null {
  if (!config.alchemy.apiKey) return null;
  const network = config.alchemy.networks[chain] || config.alchemy.networks.eth;
  return `https://${network}.g.alchemy.com/v2/${config.alchemy.apiKey}`;
}

/** Log integration availability at startup */
export function logAvailability(config: IntegrationConfig): void {
  const statuses = checkAvailability(config);
  console.log("[config] Integration availability:");
  for (const s of statuses) {
    const icon = s.available ? "✓" : "✗";
    console.log(`  ${icon} ${s.name}: ${s.reason}`);
  }
}
