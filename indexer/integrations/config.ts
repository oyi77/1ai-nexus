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
  tokenterminal: { baseUrl: string; apiKey: string | null };
  arkham: { apiKey: string | null };
  lunarcrush: { apiKey: string | null };
  xapi: { bearerToken: string | null };
  fred: { apiKey: string | null };
  coinmetrics: { apiKey: string | null };
  thegraph: { apiKey: string | null };
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
      priceUrl: "https://api.coingecko.com/api/v3/simple/price",
    },
    tokenterminal: {
      baseUrl: "https://api.tokenterminal.com/v2",
      apiKey: env("TOKEN_TERMINAL_API_KEY"),
    },
    arkham: {
      apiKey: env("ARKHAM_API_KEY"),
    },
    lunarcrush: {
      apiKey: env("LUNARCRUSH_API_KEY"),
    },
    xapi: {
      bearerToken: env("X_API_BEARER_TOKEN"),
    },
    fred: {
      apiKey: env("FRED_API_KEY"),
    },
    coinmetrics: {
      apiKey: env("COINMETRICS_API_KEY"),
    },
    thegraph: {
      apiKey: env("THE_GRAPH_API_KEY"),
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
    {
      name: "TokenTerminal",
      available: !!config.tokenterminal.apiKey,
      reason: config.tokenterminal.apiKey
        ? "API key configured"
        : "TOKEN_TERMINAL_API_KEY not set",
    },
    {
      name: "Arkham",
      available: !!config.arkham.apiKey,
      reason: config.arkham.apiKey
        ? "API key configured"
        : "ARKHAM_API_KEY not set",
    },
    {
      name: "LunarCrush",
      available: !!config.lunarcrush.apiKey,
      reason: config.lunarcrush.apiKey
        ? "API key configured"
        : "LUNARCRUSH_API_KEY not set",
    },
    {
      name: "X API",
      available: !!config.xapi.bearerToken,
      reason: config.xapi.bearerToken
        ? "Bearer token configured"
        : "X_API_BEARER_TOKEN not set",
    },
    {
      name: "FRED",
      available: !!config.fred.apiKey,
      reason: config.fred.apiKey
        ? "API key configured"
        : "FRED_API_KEY not set",
    },
    {
      name: "CoinMetrics",
      available: !!config.coinmetrics.apiKey,
      reason: config.coinmetrics.apiKey
        ? "API key configured"
        : "COINMETRICS_API_KEY not set",
    },
    {
      name: "The Graph",
      available: true, // Hosted service is free
      reason: config.thegraph.apiKey
        ? "API key configured (higher rate limits)"
        : "Free hosted service (rate limited)",
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
