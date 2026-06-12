// ─────────────────────────────────────────────────────────────
// Integration barrel — single import point for all external APIs
// ─────────────────────────────────────────────────────────────

export { buildConfig, checkAvailability, logAvailability, type IntegrationConfig, type IntegrationStatus } from "./config";
export { fetchWithRetry, fetchJson, rpcCall, createRateLimiter } from "./http-client";
export * as alchemy from "./alchemy";
export * as cex from "./cex";
export * as defillama from "./defillama";
export * as etherscan from "./etherscan";
export * as jupiter from "./jupiter";
