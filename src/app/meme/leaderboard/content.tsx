"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
              <span className="text-[10px] font-mono text-data-bull">
                ⤴ {ex.flowSignal.label}
              </span>
            )}
          </div>
        );
      },
    };
    return [...(memeColumns as unknown as Column<Record<string, unknown>>[]), why];
  }, [explanations]);

  return (
    <div className="space-y-4">
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
