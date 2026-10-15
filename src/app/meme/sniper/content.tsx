"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/shell/Panel";
import { DataTable, type Column } from "@/components/shell/DataTable";
import { LiveDot } from "@/components/primitives/LiveDot";
import { csrfFetch } from "@/lib/csrf";
import type { MemeRiskAudit } from "@/lib/modules/meme/types";
import type { DevHistoryVerdict } from "@/lib/modules/derived/dev-history";
import {
  RefreshCw,
  ExternalLink,
  X,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
type Status = "SIGNAL" | "WATCHLIST" | "REJECT";

type Entry = {
  status: Status;
  rationale: string;
  rejections: string[];
  warnings: string[];
  metrics: {
    stage: string;
    stageLabel: string;
    ageLabel: string;
    volMcRatio: number;
    requiredRatio: number;
    devPercent: number | null;
    sniperPercent: number | null;
    bundlerPercent: number | null;
    insiderPercent: number | null;
    top10Percent: number | null;
    clusterPercent: number | null;
    avgPnlPercent: number | null;
    pnlAssessment: string;
  };
  contract: string;
  ticker: string;
  deduped: boolean;
  delivered: boolean;
  auditsUsed: string[];
  devHistory?: DevHistoryVerdict | null;
  bondingCurve?: { progressPct: number; state?: string } | null;
  discoveryCategory?: string;
  discoveryEvidence?: Array<{ provider?: string; category?: string; note?: string }>;
};

type Payload = {
  entries: Entry[];
  updatedAt: string | null;
  lastScan: { at: string; scanned: number; screened: number; watchlisted: number; rejected: number; delivered: number; errors: string[] } | null;
  counts: Record<Status | "total", number>;
};

const statusClass: Record<Status, string> = {
  SIGNAL: "bg-data-bull/15 text-data-bull",
  WATCHLIST: "bg-amber-500/15 text-amber-400",
  REJECT: "bg-data-bear/15 text-data-bear",
};

const pct = (v: number | null) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 10) / 10}%`);
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

type DevRiskTier = "CLEAN" | "UNPROVEN" | "SUSPECT" | "SERIAL RUGGER";

const devRiskBadgeStyles: Record<DevRiskTier, string> = {
  CLEAN: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  UNPROVEN: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  SUSPECT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "SERIAL RUGGER": "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

function resolveDevRisk(r: Entry): { tier: DevRiskTier; detail?: string } | null {
  if (r.devHistory?.tier) {
    const t = r.devHistory.tier;
    if (t === "SERIAL_RUGGER") return { tier: "SERIAL RUGGER", detail: `${r.devHistory.ruggedCount} rug` };
    if (t === "SUSPECT") return { tier: "SUSPECT", detail: `${Math.round((r.devHistory.migrationRate ?? 0) * 100)}% mig` };
    if (t === "UNPROVEN") return { tier: "UNPROVEN", detail: "first deploy" };
    if (t === "CLEAN") return { tier: "CLEAN", detail: `${r.devHistory.migrations}/${r.devHistory.previousTokens} mig` };
  }
  const text = (r.rationale + " " + r.rejections.join(" ") + " " + r.warnings.join(" ")).toLowerCase();
  if (text.includes("serial rugger") || text.includes("serial_rugger")) return { tier: "SERIAL RUGGER" };
  if (text.includes("[dev-history]") && text.includes("suspect")) return { tier: "SUSPECT" };
  if (text.includes("[dev-history]") && text.includes("unproven")) return { tier: "UNPROVEN" };
  if (text.includes("[dev-history]") && text.includes("clean")) return { tier: "CLEAN" };
  if (r.rejections.some((s) => /honeypot|mintable|freeze/i.test(s))) return { tier: "SERIAL RUGGER", detail: "security" };
  if (r.auditsUsed?.length > 0) {
    if (r.status === "SIGNAL") return { tier: "CLEAN", detail: `${r.auditsUsed.length} audits` };
    if (r.status === "WATCHLIST") return { tier: "UNPROVEN", detail: `${r.auditsUsed.length} audits` };
    if (r.status === "REJECT") return { tier: "SUSPECT", detail: "audit warnings" };
  }
  return null;
}

function isTrenchCandidate(e: Entry): boolean {
  if (e.contract.toLowerCase().endsWith("pump")) return true;
  if (e.discoveryCategory === "BONDING") return true;
  if (e.discoveryEvidence?.some((ev) => ev.provider?.includes("trenches") || ev.provider?.includes("solpump") || ev.note?.includes("bonding"))) return true;
  if (e.metrics.stage === "bonding" || e.metrics.stageLabel?.toLowerCase().includes("bonding")) return true;
  const full = (e.rationale + " " + e.rejections.join(" ") + " " + e.warnings.join(" ")).toLowerCase();
  return full.includes("trenches") || full.includes("bonding");
}

type AuditVerdict = "Passed" | "Caution" | "High Risk";

interface AuditCardData {
  contract: string;
  symbol: string;
  name?: string;
  chain: string;
  isSolana: boolean;
  riskLevel: number;
  canMint: boolean;
  canFreeze: boolean;
  isHoneypot: boolean;
  top10Percent: number | null;
  lpLockedPercent: number | null;
  buyTax: number | null;
  sellTax: number | null;
  verdict: AuditVerdict;
  sources: string[];
}

const formatMetricPct = (v: number | null | undefined): string => {
  if (v === null || v === undefined || v < 0) return "n/a";
  const num = v > 1 ? v : v * 100;
  return `${Math.round(num * 10) / 10}%`;
};

const formatTax = (v: number | null | undefined): string => {
  if (v === null || v === undefined || v < 0) return "0%";
  const num = v > 1 ? v : v * 100;
  return `${Math.round(num * 10) / 10}%`;
};

const columns: Column<Entry>[] = [
  {
    key: "status",
    header: "Status",
    width: 96,
    accessor: (r) => r.status,
    render: (r) => (
      <span className={`px-1.5 py-0.5 text-[11px] font-mono rounded ${statusClass[r.status]}`}>
        {r.status}
      </span>
    ),
  },
  {
    key: "ticker",
    header: "Token",
    width: 130,
    accessor: (r) => r.ticker,
    render: (r) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-text-primary truncate">{r.ticker}</span>
          {isTrenchCandidate(r) && (
            <span
              className="text-[9px] px-1 py-0.2 rounded bg-purple-500/15 text-purple-300 font-mono border border-purple-500/30"
              title="Solpump Trenches / PumpFun"
            >
              trenches
            </span>
          )}
        </div>
        <div className="text-[10px] text-text-muted font-mono">{shortAddr(r.contract)}</div>
      </div>
    ),
  },
  {
    key: "devRisk",
    header: "Dev / Risk",
    width: 110,
    accessor: (r) => resolveDevRisk(r)?.tier ?? "",
    render: (r) => {
      const risk = resolveDevRisk(r);
      if (!risk) return <span className="text-text-muted text-[10px] font-mono">—</span>;
      return (
        <span
          className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-medium rounded border ${devRiskBadgeStyles[risk.tier]}`}
          title={risk.detail ? `${risk.tier}: ${risk.detail}` : risk.tier}
        >
          {risk.tier}
        </span>
      );
    },
  },
  {
    key: "stage",
    header: "Stage",
    width: 110,
    accessor: (r) => r.metrics.stageLabel,
    render: (r) => (
      <div>
        <div className="text-text-secondary text-xs">{r.metrics.stageLabel}</div>
        <div className="text-[10px] text-text-muted font-mono">{r.metrics.ageLabel}</div>
      </div>
    ),
  },
  {
    key: "volMc",
    header: "Vol/MCap",
    width: 90,
    align: "right",
    accessor: (r) => r.metrics.volMcRatio,
    render: (r) => (
      <span className={r.metrics.volMcRatio >= r.metrics.requiredRatio ? "text-data-bull" : "text-text-secondary"}>
        {r.metrics.volMcRatio.toFixed(2)}x
      </span>
    ),
  },
  {
    key: "sniper",
    header: "Sniper%",
    width: 80,
    align: "right",
    accessor: (r) => r.metrics.sniperPercent ?? -1,
    render: (r) => <span className="text-text-secondary">{pct(r.metrics.sniperPercent)}</span>,
  },
  {
    key: "bundler",
    header: "Bundler%",
    width: 90,
    align: "right",
    accessor: (r) => r.metrics.bundlerPercent ?? -1,
    render: (r) => <span className="text-text-secondary">{pct(r.metrics.bundlerPercent)}</span>,
  },
  {
    key: "top10",
    header: "Top10%",
    width: 80,
    align: "right",
    accessor: (r) => r.metrics.top10Percent ?? -1,
    render: (r) => <span className="text-text-secondary">{pct(r.metrics.top10Percent)}</span>,
  },
  {
    key: "pnl",
    header: "Holder PnL",
    width: 100,
    align: "right",
    accessor: (r) => r.metrics.avgPnlPercent ?? -99999,
    render: (r) => (
      <div>
        <div className="text-text-secondary">{pct(r.metrics.avgPnlPercent)}</div>
        <div className="text-[10px] text-text-muted">{r.metrics.pnlAssessment}</div>
      </div>
    ),
  },
  {
    key: "why",
    header: "Rationale",
    accessor: (r) => r.rationale,
    render: (r) => (
      <div className="max-w-[420px]">
        <div className="text-text-secondary text-xs truncate" title={r.rationale}>{r.rationale}</div>
        {r.rejections.length > 0 && (
          <div className="text-[10px] text-data-bear truncate" title={r.rejections.join("; ")}>
            {r.rejections.join("; ")}
          </div>
        )}
        {r.warnings.some((w) => w.includes('mismatch')) && (
          <div className="text-[10px] text-amber-400 truncate" title={r.warnings.join("; ")}>
            ⚠ {r.warnings.find((w) => w.includes('mismatch'))}
          </div>
        )}
      </div>
    ),
  },
  {
    key: "flags",
    header: "Flags",
    width: 96,
    accessor: (r) => `${r.delivered ? "d" : ""}${r.deduped ? "s" : ""}`,
    render: (r) => (
      <div className="flex gap-1">
        {r.delivered && <span className="text-[10px] px-1 rounded bg-data-bull/15 text-data-bull">sent</span>}
        {r.deduped && <span className="text-[10px] px-1 rounded bg-bg-raised text-text-muted" title="Already seen within the dedupe TTL">seen</span>}
      </div>
    ),
  },
];

export function MemeSniperPageContent() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [status, setStatus] = useState<"live" | "stale" | "error">("stale");
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  type FilterType = Status | "all" | "trenches";
  const [filter, setFilter] = useState<FilterType>("all");

  // Live Pulse / auto-refresh state
  const [pollInterval, setPollInterval] = useState<"10s" | "60s">("60s");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // On-demand token security audit state
  const [auditInput, setAuditInput] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<AuditCardData | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/meme/sniper/history");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { data: Payload };
      setPayload(d.data);
      setStatus("live");
      setLastUpdated(new Date());
    } catch {
      setStatus("error");
    }
  }, []);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    // Initial load + poll; the effect seeds state from an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const intervalMs = pollInterval === "10s" ? 10_000 : 60_000;
    const t = setInterval(() => void load(), intervalMs);
    return () => clearInterval(t);
  }, [load, pollInterval]);

  const runAudit = useCallback(async (address: string) => {
    const cleanAddress = address.trim();
    if (!cleanAddress) return;

    setAuditLoading(true);
    setAuditError(null);

    const isEvm =
      cleanAddress.startsWith("0x") ||
      (cleanAddress.length === 40 && /^[a-fA-F0-9]{40}$/.test(cleanAddress));
    const isSolana = !isEvm;
    const cleanContract =
      isEvm && !cleanAddress.startsWith("0x") ? `0x${cleanAddress}` : cleanAddress;
    const chain = isSolana ? "solana" : "ethereum";

    try {
      const res = await fetch(
        `/api/v1/meme/risk?platform=all&contract=${cleanContract}&chain=${chain}`,
      );
      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errJson?.error ?? `Audit failed with HTTP ${res.status}`);
      }
      const json = (await res.json()) as { data?: MemeRiskAudit[]; error?: string };
      if (json.error) {
        throw new Error(json.error);
      }
      const audits = Array.isArray(json.data) ? json.data : [];
      if (audits.length === 0) {
        throw new Error("No audit data returned for this contract. Verify the contract address and network.");
      }

      const symbol = audits.find((a) => a.symbol && a.symbol.trim() !== "")?.symbol || "UNKNOWN";
      const name = audits.find((a) => a.name && a.name.trim() !== "")?.name || "";
      const riskLevel = Math.max(0, ...audits.map((a) => (typeof a.riskLevel === "number" ? a.riskLevel : 0)));
      const isHoneypot = audits.some((a) => Boolean(a.isHoneypot));
      const canFreeze = audits.some((a) => Boolean(a.canFreeze));
      const canMint = audits.some((a) => Boolean(a.canMint));

      const top10HolderPercents = audits
        .map((a) => a.top10HolderPercent)
        .filter((v): v is number => typeof v === "number" && v >= 0);
      const top10Percent = top10HolderPercents.length > 0 ? Math.max(...top10HolderPercents) : null;

      const lpLockedPercents = audits
        .map((a) => a.lpLockedPercent)
        .filter((v): v is number => typeof v === "number" && v >= 0);
      const lpLockedPercent = lpLockedPercents.length > 0 ? Math.max(...lpLockedPercents) : null;

      const buyTaxes = audits
        .map((a) => a.buyTax)
        .filter((v): v is number => typeof v === "number" && v >= 0);
      const buyTax = buyTaxes.length > 0 ? Math.max(...buyTaxes) : null;

      const sellTaxes = audits
        .map((a) => a.sellTax)
        .filter((v): v is number => typeof v === "number" && v >= 0);
      const sellTax = sellTaxes.length > 0 ? Math.max(...sellTaxes) : null;

      const top10Val = top10Percent !== null ? (top10Percent > 1 ? top10Percent : top10Percent * 100) : null;
      const isTop10High = top10Val !== null && top10Val > 30;

      let verdict: AuditVerdict = "Passed";
      if (isHoneypot || riskLevel >= 3 || canFreeze) {
        verdict = "High Risk";
      } else if (riskLevel === 2 || isTop10High || canMint) {
        verdict = "Caution";
      } else {
        verdict = "Passed";
      }

      const sources = Array.from(new Set(audits.map((a) => a.platform).filter(Boolean)));

      setAuditResult({
        contract: cleanContract,
        symbol,
        name,
        chain,
        isSolana,
        riskLevel,
        canMint,
        canFreeze,
        isHoneypot,
        top10Percent,
        lpLockedPercent,
        buyTax,
        sellTax,
        verdict,
        sources,
      });
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : "Audit failed");
      setAuditResult(null);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const handleAuditSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void runAudit(auditInput);
    },
    [auditInput, runAudit],
  );

  const runScan = useCallback(
    async (deliver: boolean) => {
      setScanning(true);
      setNotice(null);
      try {
        const res = await csrfFetch("/api/v1/meme/sniper/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 5, deliver }),
        });
        const d = (await res.json()) as { data?: Payload & { scanned?: number }; error?: string };
        if (!res.ok) {
          setNotice(d.error ?? `Scan failed (HTTP ${res.status})`);
        } else if (d.data) {
          setPayload((prev) =>
            prev ? { ...prev, entries: d.data!.entries, counts: d.data!.counts } : prev,
          );
          setNotice(`Scanned ${d.data.scanned ?? 0} — signal ${d.data.counts.SIGNAL}, watch ${d.data.counts.WATCHLIST}, reject ${d.data.counts.REJECT}${deliver ? `, pushed ${"delivered" in d.data ? d.data.delivered : 0}` : ""}`);
        }
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setScanning(false);
      }
    },
    [],
  );

  const lastUpdatedFormatted = lastUpdated
    ? lastUpdated.toLocaleTimeString()
    : payload?.updatedAt
    ? new Date(payload.updatedAt).toLocaleTimeString()
    : "never";

  const rows = payload
    ? filter === "all"
      ? payload.entries
      : filter === "trenches"
      ? payload.entries.filter(isTrenchCandidate)
      : payload.entries.filter((e) => e.status === filter)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-stretch gap-3">
        <Panel title="Scan" subtitle={payload?.lastScan?.at ? new Date(payload.lastScan.at).toLocaleTimeString() : "never"} className="min-w-[280px]">
          <div className="px-3 py-2 flex items-center gap-2">
            <button
              onClick={() => void runScan(false)}
              disabled={scanning}
              className="px-2 py-1 text-xs border border-bg-border hover:bg-bg-raised disabled:opacity-50 rounded"
            >
              {scanning ? "Scanning…" : "Scan"}
            </button>
            <button
              onClick={() => void runScan(true)}
              disabled={scanning}
              className="px-2 py-1 text-xs border border-bg-border hover:bg-bg-raised disabled:opacity-50 rounded"
              title="Also push SIGNAL/WATCHLIST alerts to Telegram"
            >
              Scan + push
            </button>
            <button onClick={() => void load()} className="p-1 text-text-muted hover:text-text-secondary" title="Refresh">
              <LiveDot status={status} size={5} />
            </button>
          </div>
          {notice && <div className="px-3 pb-2 text-[11px] text-text-secondary">{notice}</div>}
          {payload?.lastScan && payload.lastScan.errors.length > 0 && (
            <div className="px-3 pb-2 text-[11px] text-data-bear">{payload.lastScan.errors.join("; ")}</div>
          )}
        </Panel>

        <Panel
          title="Live Pulse"
          subtitle={lastUpdatedFormatted}
          className="min-w-[280px]"
        >
          <div className="px-3 py-2 flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-xs font-mono text-text-secondary" title="Last update time">
              <LiveDot status={status === "live" ? "live" : "stale"} size={6} />
              <span className="text-[11px]">{lastUpdatedFormatted}</span>
            </div>

            <div className="inline-flex rounded border border-bg-border bg-bg-base p-0.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => setPollInterval("10s")}
                className={`px-2 py-0.5 rounded transition-colors ${
                  pollInterval === "10s"
                    ? "bg-teal-vivid/20 text-teal-vivid font-semibold"
                    : "text-text-muted hover:text-text-primary"
                }`}
                title="Poll every 10 seconds"
              >
                Live (10s)
              </button>
              <button
                type="button"
                onClick={() => setPollInterval("60s")}
                className={`px-2 py-0.5 rounded transition-colors ${
                  pollInterval === "60s"
                    ? "bg-bg-raised text-text-primary font-semibold"
                    : "text-text-muted hover:text-text-primary"
                }`}
                title="Poll every 60 seconds"
              >
                Normal (60s)
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleManualRefresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-mono border border-bg-border rounded hover:bg-bg-raised disabled:opacity-50 text-text-secondary hover:text-text-primary transition-colors"
              title="Manual refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
            </button>
          </div>
        </Panel>

        <Panel title="Decisions" subtitle={`${payload?.counts.total ?? 0} logged`} className="min-w-[240px]">
          <div className="px-3 py-2 flex items-center gap-3 text-xs font-mono">
            {([
              { id: "all" as const, label: `all ${payload?.counts.total ?? 0}` },
              { id: "SIGNAL" as const, label: `signals ${payload?.counts.SIGNAL ?? 0}` },
              { id: "WATCHLIST" as const, label: `watchlist ${payload?.counts.WATCHLIST ?? 0}` },
              { id: "REJECT" as const, label: `rejected ${payload?.counts.REJECT ?? 0}` },
              { id: "trenches" as const, label: `trenches ${payload ? payload.entries.filter(isTrenchCandidate).length : 0}` },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  filter === t.id ? "bg-bg-raised text-text-primary font-semibold" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          title="Token Security Audit"
          subtitle="On-demand safety check"
          className="flex-1 min-w-[320px]"
        >
          <div className="px-3 py-2">
            <form onSubmit={handleAuditSubmit} className="flex items-center gap-2">
              <input
                type="text"
                value={auditInput}
                onChange={(e) => setAuditInput(e.target.value)}
                placeholder="Paste token address (Solana or EVM) to audit…"
                className="flex-1 min-w-[200px] bg-bg-base border border-bg-border rounded px-2.5 py-1 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-teal-vivid"
              />
              <button
                type="submit"
                disabled={auditLoading || !auditInput.trim()}
                className="shrink-0 px-2.5 py-1 text-xs font-mono rounded bg-teal-vivid/20 text-teal-vivid border border-teal-vivid/40 hover:bg-teal-vivid/30 disabled:opacity-50 transition-colors"
              >
                {auditLoading ? "Auditing…" : "Audit Safety"}
              </button>
            </form>
            {auditError && (
              <div className="mt-1 text-[11px] text-data-bear">{auditError}</div>
            )}
          </div>
        </Panel>
      </div>

      {auditResult && (
        <div
          role="region"
          aria-label="Token Security Audit Result"
          className={`flex flex-col bg-bg-panel border rounded p-3 transition-colors ${
            auditResult.verdict === "Passed"
              ? "border-emerald-500/40 bg-emerald-950/10"
              : auditResult.verdict === "Caution"
              ? "border-amber-500/40 bg-amber-950/10"
              : "border-rose-500/40 bg-rose-950/10"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bg-border/60 pb-2 mb-2.5">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-semibold text-text-primary text-sm font-mono">
                {auditResult.symbol}
              </span>
              {auditResult.name && (
                <span className="text-xs text-text-muted truncate max-w-[160px]">
                  {auditResult.name}
                </span>
              )}
              <span
                className="text-[11px] font-mono text-text-muted bg-bg-base px-1.5 py-0.5 rounded border border-bg-border truncate max-w-[200px]"
                title={auditResult.contract}
              >
                {shortAddr(auditResult.contract)}
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted border border-bg-border">
                {auditResult.chain}
              </span>

              <span
                className={`px-2 py-0.5 text-xs font-mono font-medium rounded flex items-center gap-1 border ${
                  auditResult.verdict === "Passed"
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                    : auditResult.verdict === "Caution"
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                    : "bg-rose-500/20 text-rose-400 border-rose-500/40"
                }`}
              >
                {auditResult.verdict === "Passed" && (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )}
                {auditResult.verdict === "Caution" && (
                  <AlertTriangle className="w-3.5 h-3.5" />
                )}
                {auditResult.verdict === "High Risk" && (
                  <ShieldAlert className="w-3.5 h-3.5" />
                )}
                <span>{auditResult.verdict}</span>
              </span>
            </div>

            <div className="flex items-center gap-3">
              {auditResult.isSolana && (
                <a
                  href={`https://rugcheck.xyz/tokens/${auditResult.contract}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-mono text-teal-vivid hover:underline decoration-dotted"
                  title="View token safety on RugCheck"
                >
                  <span>RugCheck</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <a
                href={`https://dexscreener.com/${auditResult.chain}/${auditResult.contract}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-mono text-teal-vivid hover:underline decoration-dotted"
                title="View token chart & liquidity on DexScreener"
              >
                <span>DexScreener</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={() => setAuditResult(null)}
                className="px-2 py-0.5 text-xs font-mono text-text-muted hover:text-text-primary border border-bg-border hover:bg-bg-raised rounded inline-flex items-center gap-1 transition-colors"
                title="Dismiss audit card"
              >
                <X className="w-3 h-3" />
                <span>Close</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            <div className="bg-bg-base/70 p-2 rounded border border-bg-border/60">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider">Risk Level</div>
              <div className={`font-mono text-sm font-medium mt-0.5 ${auditResult.riskLevel >= 3 ? "text-rose-400" : auditResult.riskLevel === 2 ? "text-amber-400" : "text-emerald-400"}`}>
                {auditResult.riskLevel}/3
              </div>
            </div>
            <div className="bg-bg-base/70 p-2 rounded border border-bg-border/60">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider">Mint Auth</div>
              <div className={`font-mono text-sm font-medium mt-0.5 ${auditResult.canMint ? "text-amber-400" : "text-emerald-400"}`}>
                {auditResult.canMint ? "Enabled" : "Renounced"}
              </div>
            </div>
            <div className="bg-bg-base/70 p-2 rounded border border-bg-border/60">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider">Freeze Auth</div>
              <div className={`font-mono text-sm font-medium mt-0.5 ${auditResult.canFreeze ? "text-rose-400" : "text-emerald-400"}`}>
                {auditResult.canFreeze ? "Enabled" : "Disabled"}
              </div>
            </div>
            <div className="bg-bg-base/70 p-2 rounded border border-bg-border/60">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider">Top 10 Holders %</div>
              <div className={`font-mono text-sm font-medium mt-0.5 ${auditResult.top10Percent !== null && (auditResult.top10Percent > 1 ? auditResult.top10Percent : auditResult.top10Percent * 100) > 30 ? "text-amber-400" : "text-text-primary"}`}>
                {formatMetricPct(auditResult.top10Percent)}
              </div>
            </div>
            <div className="bg-bg-base/70 p-2 rounded border border-bg-border/60">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider">LP Locked %</div>
              <div className={`font-mono text-sm font-medium mt-0.5 ${auditResult.lpLockedPercent !== null && auditResult.lpLockedPercent >= 0 ? ((auditResult.lpLockedPercent > 1 ? auditResult.lpLockedPercent >= 80 : auditResult.lpLockedPercent >= 0.8) ? "text-emerald-400" : "text-amber-400") : "text-text-muted"}`}>
                {formatMetricPct(auditResult.lpLockedPercent)}
              </div>
            </div>
            <div className="bg-bg-base/70 p-2 rounded border border-bg-border/60">
              <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider">Buy / Sell Tax</div>
              <div className="font-mono text-sm font-medium mt-0.5 text-text-primary">
                {formatTax(auditResult.buyTax)} / {formatTax(auditResult.sellTax)}
              </div>
            </div>
          </div>
        </div>
      )}

      <Panel title="Decision Log" subtitle="newest first" liveStatus={status} onRefresh={load} maxHeight="70vh">
        <DataTable
          columns={columns}
          data={rows}
          sortable
          filterable
          filterPlaceholder="Filter by token, status, rationale…"
          emptyState={
            <div className="p-6 text-center text-xs text-text-muted">
              No decisions logged yet. The cron runs every 10 minutes — or press Scan to evaluate now.
            </div>
          }
        />
      </Panel>
    </div>
  );
}
