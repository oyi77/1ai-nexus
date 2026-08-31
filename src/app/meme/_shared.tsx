import type { Column } from "@/components/shell/DataTable";
import type { MemeAlphaToken, MemeRiskAudit } from "@/lib/modules/meme/types";
import { PriceTag } from "@/components/primitives/PriceTag";

export const MEME_PLATFORMS = [
  "all",
  "bitget",
  "gate",
  "botx",
  "dexscreener",
  "moby",
  "birdeye",
  "rugcheck",
  "geckoterminal",
  "gmgn",
  "fomo",
  "photon",
] as const;
export type MemePlatformFilter = (typeof MEME_PLATFORMS)[number];

export function fmtUsd(n: number): string {
  if (!n || n <= 0) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

const riskClass = (lvl: number) =>
  [
    "bg-data-bull/15 text-data-bull",
    "bg-amber-500/15 text-amber-400",
    "bg-orange-500/15 text-orange-400",
    "bg-data-bear/15 text-data-bear",
  ][Math.max(0, Math.min(3, lvl))];

export const memeColumns: Column<MemeAlphaToken>[] = [
  {
    key: "rank",
    header: "#",
    width: 50,
    render: (_r, i) => (
      <span className="text-xs font-mono text-text-muted">#{i + 1}</span>
    ),
  },
  {
    key: "symbol",
    header: "Symbol",
    width: 110,
    render: (r) => (
      <span className="text-xs font-mono font-bold text-text-primary">
        {r.symbol}
      </span>
    ),
  },
  {
    key: "name",
    header: "Name",
    width: 160,
    render: (r) => (
      <span className="text-xs text-text-secondary truncate max-w-[140px]">
        {r.name}
      </span>
    ),
  },
  {
    key: "chain",
    header: "Chain",
    width: 90,
    render: (r) => (
      <span className="text-xs font-mono text-text-muted">{r.chain}</span>
    ),
  },
  {
    key: "price",
    header: "Price",
    width: 100,
    align: "right",
    render: (r) => <PriceTag value={r.price} size="sm" />,
  },
  {
    key: "change24h",
    header: "24h",
    width: 90,
    align: "right",
    render: (r) => (
      <span
        className={`text-xs font-mono tabular-nums ${
          r.change24h >= 0 ? "text-data-bull" : "text-data-bear"
        }`}
      >
        {(r.change24h * 100).toFixed(1)}%
      </span>
    ),
  },
  {
    key: "volume24h",
    header: "Vol 24h",
    width: 100,
    align: "right",
    render: (r) => (
      <span className="text-xs font-mono text-text-secondary tabular-nums">
        {fmtUsd(r.volume24h)}
      </span>
    ),
  },
  {
    key: "marketCap",
    header: "Mkt Cap",
    width: 100,
    align: "right",
    render: (r) => (
      <span className="text-xs font-mono text-text-secondary tabular-nums">
        {fmtUsd(r.marketCap)}
      </span>
    ),
  },
  {
    key: "liquidity",
    header: "Liquidity",
    width: 100,
    align: "right",
    render: (r) => (
      <span className="text-xs font-mono text-text-secondary tabular-nums">
        {fmtUsd(r.liquidity)}
      </span>
    ),
  },
  {
    key: "holders",
    header: "Holders",
    width: 90,
    align: "right",
    render: (r) => (
      <span className="text-xs font-mono tabular-nums">{r.holders}</span>
    ),
  },
  {
    key: "riskLevel",
    header: "Risk",
    width: 80,
    render: (r) => (
      <span
        className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${riskClass(
          r.riskLevel
        )}`}
      >
        L{r.riskLevel}
      </span>
    ),
  },
  {
    key: "top10HolderPercent",
    header: "Top10",
    width: 90,
    align: "right",
    render: (r) => (
      <span className="text-xs font-mono tabular-nums">
        {(r.top10HolderPercent * 100).toFixed(1)}%
      </span>
    ),
  },
  {
    key: "flow",
    header: "Flow",
    width: 90,
    align: "right",
    render: (r) => {
      const buys = Number(r.buyCount24h ?? 0);
      const sells = Number(r.sellCount24h ?? 0);
      if (buys <= 0 && sells <= 0) return <span className="text-xs font-mono text-text-muted">—</span>;
      const ratio = buys / Math.max(1, sells);
      const color = ratio > 1.2 ? "text-data-bull" : ratio < 0.8 ? "text-data-bear" : "text-text-secondary";
      return (
        <span className={`text-xs font-mono tabular-nums ${color}`}>
          {ratio >= 1 ? `B ${ratio.toFixed(1)}:1` : `S ${(1 / ratio).toFixed(1)}:1`}
        </span>
      );
    },
  },
];

export const riskColumns: Column<MemeRiskAudit>[] = [
  { key: "symbol", header: "Token", width: 160, accessor: (r) => r.symbol, render: (r) => (
    <span className="font-medium text-text">{r.symbol}</span>
  ) },
  { key: "platform", header: "Platform", width: 90, accessor: (r) => r.platform },
  { key: "chain", header: "Chain", width: 80, accessor: (r) => r.chain },
  { key: "riskLabel", header: "Risk", width: 90, accessor: (r) => r.riskLabel, render: (r) => (
    <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${riskClass(r.riskLevel)}`}>{r.riskLabel.toUpperCase()}</span>
  ) },
  { key: "top10HolderPercent", header: "Top10 %", width: 90, align: "right", accessor: (r) => r.top10HolderPercent, render: (r) => `${r.top10HolderPercent?.toFixed(1) ?? "—"}%` },
  { key: "lpLockedPercent", header: "LP Locked %", width: 110, align: "right", accessor: (r) => r.lpLockedPercent, render: (r) => `${r.lpLockedPercent?.toFixed(1) ?? "—"}%` },
  { key: "buyTax", header: "Buy Tax %", width: 90, align: "right", accessor: (r) => r.buyTax, render: (r) => `${r.buyTax?.toFixed(2) ?? "—"}%` },
  { key: "sellTax", header: "Sell Tax %", width: 90, align: "right", accessor: (r) => r.sellTax, render: (r) => `${r.sellTax?.toFixed(2) ?? "—"}%` },
  { key: "flags", header: "Flags", width: 120, render: (r) => (
    <span className="text-text-muted text-xs">
      {[r.canFreeze && "Freeze", r.canMint && "Mint"].filter(Boolean).join(" · ") || "—"}
    </span>
  ) },
];
