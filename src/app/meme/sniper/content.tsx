"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/shell/Panel";
import { DataTable, type Column } from "@/components/shell/DataTable";
import { LiveDot } from "@/components/primitives/LiveDot";
import { csrfFetch } from "@/lib/csrf";

type Status = "EXECUTE" | "WATCHLIST" | "REJECT";

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
  plan: { sizeUsd: number; stopLossPct: number; tp1Pct: number; tp2Pct: number };
  contract: string;
  ticker: string;
  deduped: boolean;
  delivered: boolean;
  auditsUsed: string[];
};

type Circuit = {
  date: string;
  consecutiveLosses: number;
  wins: number;
  locked: boolean;
  updatedAt: string;
};

type Payload = {
  entries: Entry[];
  updatedAt: string | null;
  lastScan: { at: string; scanned: number; executed: number; watchlisted: number; rejected: number; delivered: number; errors: string[] } | null;
  counts: Record<Status | "total", number>;
  circuit: Circuit;
  /** False = the evaluator can never emit EXECUTE (WATCHLIST-only mode). */
  executeEnabled: boolean;
};

const statusClass: Record<Status, string> = {
  EXECUTE: "bg-data-bull/15 text-data-bull",
  WATCHLIST: "bg-amber-500/15 text-amber-400",
  REJECT: "bg-data-bear/15 text-data-bear",
};

const pct = (v: number | null) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 10) / 10}%`);
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

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
        <div className="text-text-primary truncate">{r.ticker}</div>
        <div className="text-[10px] text-text-muted font-mono">{shortAddr(r.contract)}</div>
      </div>
    ),
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
  const [filter, setFilter] = useState<Status | "all">("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/meme/sniper/history");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { data: Payload };
      setPayload(d.data);
      setStatus("live");
    } catch {
      setStatus("error");
    }
  }, []);
  useEffect(() => {
    // Initial load + poll; the effect seeds state from an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

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
            prev ? { ...prev, entries: d.data!.entries, counts: d.data!.counts, circuit: d.data!.circuit } : prev,
          );
          setNotice(`Scanned ${d.data.scanned ?? 0} — execute ${d.data.counts.EXECUTE}, watch ${d.data.counts.WATCHLIST}, reject ${d.data.counts.REJECT}${deliver ? `, pushed ${"delivered" in d.data ? d.data.delivered : 0}` : ""}`);
        }
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setScanning(false);
      }
    },
    [],
  );

  const rows = payload ? (filter === "all" ? payload.entries : payload.entries.filter((e) => e.status === filter)) : [];
  const circuit = payload?.circuit;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Panel
          title="Daily Circuit"
          subtitle={circuit ? circuit.date : undefined}
          liveStatus={status}
          className="min-w-[240px]"
        >
          <div className="px-3 py-2 flex items-center gap-4 text-xs font-mono">
            <span className={circuit?.locked ? "text-data-bear" : "text-data-bull"}>
              {circuit?.locked ? "LOCKED" : "OPEN"}
            </span>
            <span className="text-text-secondary">losses {circuit?.consecutiveLosses ?? 0}/3</span>
            <span className="text-text-secondary">wins {circuit?.wins ?? 0}</span>
          </div>
        </Panel>

        <Panel title="Execution Gate" subtitle="SNIPER_EXECUTE_ENABLED" className="min-w-[240px]">
          <div className="px-3 py-2 text-xs font-mono">
            <span className={payload?.executeEnabled ? "text-data-bull" : "text-amber-400"}>
              {payload?.executeEnabled ? "OPEN — EXECUTE allowed" : "GATED — WATCHLIST only"}
            </span>
            {!payload?.executeEnabled && payload !== null && (
              <div className="text-[11px] text-text-muted mt-1">
                Hard filters can still be reported; nothing enters on EXECUTE until the gate opens.
              </div>
            )}
          </div>
        </Panel>

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
              title="Also push EXECUTE/WATCHLIST alerts to Telegram"
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

        <Panel title="Decisions" subtitle={`${payload?.counts.total ?? 0} logged`} className="min-w-[240px]">
          <div className="px-3 py-2 flex items-center gap-3 text-xs font-mono">
            {(["all", "EXECUTE", "WATCHLIST", "REJECT"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-1.5 py-0.5 rounded ${filter === k ? "bg-bg-raised text-text-primary" : "text-text-muted hover:text-text-secondary"}`}
              >
                {k === "all" ? `all ${payload?.counts.total ?? 0}` : `${k.toLowerCase()} ${payload?.counts[k as Status] ?? 0}`}
              </button>
            ))}
          </div>
        </Panel>
      </div>

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
