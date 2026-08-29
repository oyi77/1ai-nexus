"use client";
import Link from "next/link";
import { Panel } from "@/components/shell/Panel";

type MemeCard = {
  title: string;
  href: string;
  desc: string;
};

const CARDS: MemeCard[] = [
  {
    title: "Launch Alpha",
    href: "/meme/launch-alpha",
    desc: "Recently launched meme tokens across Bitget Wallet, Gate.io DEX, BotX, and DEX Screener, sorted by listing time.",
  },
  {
    title: "Leaderboard",
    href: "/meme/leaderboard",
    desc: "Ranked meme-token discovery feed with price, volume, liquidity, holders and risk level.",
  },
  {
    title: "Risk Audit",
    href: "/meme/risk",
    desc: "Run a honeypot / rug-pull risk audit on any token contract: taxes, top-10 hold, LP lock, freeze/mint flags.",
  },
]

export function MemeIndexPageContent() {
  return (
    <div className="space-y-4">
      <Panel
        title="Meme Alpha"
        subtitle="Meme-token discovery & risk audit across Bitget Wallet and Gate.io DEX."
      >
        <p className="text-sm text-text-secondary">
          Real-time alpha for newly launched and trending meme tokens, plus a
          contract-level honeypot / rug-pull risk audit. Pick a surface below.
        </p>
      </Panel>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block rounded-lg border border-border-subtle bg-bg-raised p-4 hover:border-border-strong transition-colors"
          >
            <div className="text-sm font-semibold text-text-primary">
              {c.title}
            </div>
            <div className="mt-1 text-xs text-text-secondary leading-relaxed">
              {c.desc}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
