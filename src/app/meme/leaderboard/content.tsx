"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { Panel } from "@/components/shell/Panel";
import { DataTable, type Column } from "@/components/shell/DataTable";
import { LiveDot } from "@/components/primitives/LiveDot";
import {
  memeColumns,
  MEME_PLATFORMS,
  type MemePlatformFilter,
} from "../_shared";
import type { MemeAlphaToken, MemePlatform } from "@/lib/modules/meme/types";

type Meta = {
  platforms: MemePlatform[];
  total: number;
  updatedAt: string;
  platformsStatus: Record<string, { ok: boolean; error?: string }>;
};

type Explanation = {
  score: number;
  reasons: { points: number; code: string; label: string }[];
  flowSignal?: { code: string; label: string } | null;
};

export function MemeLeaderboardPageContent() {
  const router = useRouter();
  const [platform, setPlatform] = useState<MemePlatformFilter>("all");
  const [tokens, setTokens] = useState<MemeAlphaToken[]>([]);
  const [explanations, setExplanations] = useState<Record<string, Explanation> | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [status, setStatus] = useState<"live" | "stale" | "error">("stale");

  const fetchData = useCallback(async () => {
    setStatus("stale");
    try {
      const res = await fetch(`/api/v1/meme/leaderboard?platform=${platform}&explain=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as {
        tokens: MemeAlphaToken[];
        meta: Meta;
        explanations?: Record<string, Explanation> | null;
      };
      setTokens(d.tokens);
      setExplanations(d.explanations ?? null);
      setMeta(d.meta);
      setStatus("live");
    } catch {
      setStatus("error");
    }
  }, [platform]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const platformError = meta?.platformsStatus?.[platform]?.error ?? null;

  // Append a "Why" column that renders the score decomposition for each token.
  const columns = useMemo(() => {
    if (!explanations) return memeColumns as unknown as Column<Record<string, unknown>>[];
    const why: Column<Record<string, unknown>> = {
      key: "why",
      header: "Why",
      width: 200,
      render: (row) => {
        const id = String((row as unknown as MemeAlphaToken).id ?? "");
        const ex = explanations[id];
        if (!ex) return <span className="text-xs font-mono text-text-muted">—</span>;
        return (
          <div className="flex flex-col gap-0.5">
            {ex.reasons.slice(0, 3).map((r) => (
              <span key={r.code} className="text-[10px] font-mono text-text-secondary">
                <span className="text-teal-vivid">{r.code}</span>{" "}
                <span className="text-text-muted">{r.points >= 0 ? "+" : ""}{r.points.toFixed(2)}</span>
              </span>
            ))}
            {ex.flowSignal && (
              <span className="text-[10px] font-mono text-data-bull inline-flex items-center gap-1">
                <TrendingUp className="w-3 h-3 shrink-0" />
                <span>{ex.flowSignal.label}</span>
              </span>
            )}
          </div>
        );
      },
    };
    return [...(memeColumns as unknown as Column<Record<string, unknown>>[]), why];
  }, [explanations]);

 const flowSummary = useMemo(() => {
   const counts = new Map<string, { count: number; topTokens: string[] }>()
   Object.entries(explanations ?? {}).forEach(([id, ex]) => {
     if (!ex.flowSignal) return
     const flow = ex.flowSignal
     counts.set(flow.code, {
       count: (counts.get(flow.code)?.count ?? 0) + 1,
       topTokens: [...(counts.get(flow.code)?.topTokens ?? []), id],
     })
   })
   return Array.from(counts.entries()).map(([code, agg]) => ({
     code,
     label: explanations?.[agg.topTokens[0]]?.flowSignal?.label ?? code,
     count: agg.count,
     tokens: agg.topTokens.slice(0, 5),
   })).sort((a, b) => b.count - a.count)
 }, [explanations])

  return (
    <div className="space-y-4">
    <Panel title="Flow Intelligence" subtitle="Aggregated smart-money flow signals">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {flowSummary.length === 0 ? (
          <p className="text-xs text-text-muted col-span-full">No flow signals detected in current selection.</p>
        ) : (
          flowSummary.map((f) => (
            <div key={f.code} className="flex flex-col gap-1 p-2 rounded border border-border-subtle bg-bg-raised">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-text-primary uppercase">{f.label}</span>
                <span className="text-[10px] font-mono text-emerald-400">{f.count} tokens</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {f.tokens.map((t) => (
                  <span key={t} className="text-[9px] font-mono px-1 rounded bg-slate-900 border border-border-subtle text-text-secondary">
                    {t.slice(0, 4)}...
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>

    <Panel
      title="Meme Leaderboard"
      subtitle={`Ranked meme-token discovery · ${meta ? meta.total : 0} tokens${
        platformError ? ` · ${platformError}` : ""
      }`}
        liveStatus={status}
        onRefresh={fetchData}
      >
        <div className="flex flex-wrap gap-2">
          {MEME_PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`rounded-md px-3 py-1 text-xs font-mono uppercase transition-colors ${
                platform === p
                  ? "bg-bg-strong text-text-primary"
                  : "bg-bg-raised text-text-muted hover:text-text-primary"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </Panel>

      <div className="flex items-center gap-2 text-xs text-text-muted">
        <LiveDot status={status} />
        <span>
          {status === "stale"
            ? "Loading…"
            : status === "error"
            ? "Failed to load"
            : `${tokens.length} tokens`}
        </span>
        {explanations && (
          <span className="text-text-muted">· explain on</span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={tokens as unknown as Record<string, unknown>[]}
        sortable
        filterable
        filterPlaceholder="Filter tokens…"
        rowHeight={36}
        onRowClick={(row) => {
          const t = row as unknown as MemeAlphaToken;
          router.push(
            `/meme/risk?chain=${encodeURIComponent(
              t.chain
            )}&contract=${encodeURIComponent(t.contract)}`
          );
        }}
      />
    </div>
  );
}
