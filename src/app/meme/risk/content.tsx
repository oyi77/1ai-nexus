"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Panel } from "@/components/shell/Panel";
import { DataTable, type Column } from "@/components/shell/DataTable";
import { LiveDot } from "@/components/primitives/LiveDot";
import { riskColumns } from "../_shared";
import type { MemeRiskAudit } from "@/lib/modules/meme/types";

// Platforms with an audit module (leaderboard-only sources are excluded).
const RISK_PLATFORMS = ["all", "bitget", "gate", "botx", "birdeye", "rugcheck"] as const;
type RiskPlatform = (typeof RISK_PLATFORMS)[number];

type Meta = {
  platform: string;
  platforms: { platform: string; ok: boolean; error?: string }[];
  count: number;
  timestamp: string;
};

export function MemeRiskPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const chainParam = params.get("chain") ?? "";
  const contractParam = params.get("contract") ?? "";
  const platformParam = (params.get("platform") ?? "all").toLowerCase();

  const [chain, setChain] = useState(chainParam);
  const [contract, setContract] = useState(contractParam);
  const [platform, setPlatform] = useState<RiskPlatform>(
    (RISK_PLATFORMS as readonly string[]).includes(platformParam)
      ? (platformParam as RiskPlatform)
      : "all",
  );
  const [audits, setAudits] = useState<MemeRiskAudit[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [status, setStatus] = useState<"live" | "stale" | "error">("stale");

  const runAudit = useCallback((c: string, k: string, p: RiskPlatform) => {
    if (!c.trim()) return;
    setStatus("stale");
    fetch(
      `/api/v1/meme/risk?platform=${p}&chain=${encodeURIComponent(k)}&contract=${encodeURIComponent(c)}`,
    )
      .then((r) => r.json())
      .then((d: { data: MemeRiskAudit[]; meta: Meta }) => {
        setAudits(d.data ?? []);
        setMeta(d.meta ?? null);
        setStatus("live");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (contractParam.trim()) runAudit(contractParam, chainParam, platform);
    else setStatus("stale");
  }, [contractParam, chainParam, platform, runAudit]);

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    router.push(
      `/meme/risk?platform=${platform}&chain=${encodeURIComponent(chain)}&contract=${encodeURIComponent(contract)}`,
    );
  };

  const platformErrors = meta?.platforms
    ?.filter((p) => !p.ok)
    .map((p) => `${p.platform}: ${p.error ?? "failed"}`)
    .join("; ");

  return (
    <div className="space-y-4">
      <Panel
        title="Meme Risk Audit"
        subtitle="Honeypot / rug-pull risk audit per token contract"
        liveStatus={contractParam ? status : undefined}
        onRefresh={() => contractParam && runAudit(contractParam, chainParam, platform)}
      >
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Chain
            <input
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              placeholder="e.g. bsc"
              className="bg-bg-base border border-bg-border rounded px-2 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-teal-vivid"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Contract
            <input
              value={contract}
              onChange={(e) => setContract(e.target.value)}
              placeholder="0x…"
              className="w-80 bg-bg-base border border-bg-border rounded px-2 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-teal-vivid"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Source
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as RiskPlatform)}
              className="bg-bg-base border border-bg-border rounded px-2 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-teal-vivid"
            >
              {RISK_PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md px-3 py-1.5 text-xs font-mono bg-teal-vivid text-bg-base hover:opacity-90"
          >
            Run Audit
          </button>
        </form>
        {platformErrors && (
          <p className="mt-2 text-xs text-data-bear">{platformErrors}</p>
        )}
      </Panel>

      {contractParam && (
        <>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <LiveDot status={status} />
            <span>
              {status === "stale"
                ? "Loading…"
                : status === "error"
                ? "Failed to load"
                : `${audits.length} audits`}
            </span>
          </div>
          <DataTable
            columns={riskColumns as unknown as Column<Record<string, unknown>>[]}
            data={audits as unknown as Record<string, unknown>[]}
            sortable
            filterable
            filterPlaceholder="Filter audits…"
            rowHeight={36}
          />
        </>
      )}
    </div>
  );
}
