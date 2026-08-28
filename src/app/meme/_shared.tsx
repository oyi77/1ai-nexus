import type { Column } from "@/components/shell/DataTable";
import type { MemeAlphaToken } from "@/lib/modules/meme/types";
import { PriceTag } from "@/components/primitives/PriceTag";

export const MEME_PLATFORMS = ["all", "bitget", "gate", "botx"] as const;
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
    key: "audited",
    header: "Audited",
    width: 80,
    render: (r) => (
      <span className="text-xs font-mono">
        {r.audited ? "✓" : "—"}
      </span>
    ),
  },
];
