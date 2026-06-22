"use client";

import { Bell, Search, Wallet, User } from "lucide-react";

export function TopNav() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-white/5 bg-bg-surface px-4">
      <div className="flex items-center gap-3 flex-1">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search wallets, entities, tokens... (Ctrl+K)"
            className="h-8 w-full rounded-lg border border-white/5 bg-bg-elevated pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-cyan/40 transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="relative flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors">
          <Bell className="h-4 w-4" />
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
            3
          </span>
        </button>

        <button className="flex h-8 items-center gap-1.5 rounded-lg bg-accent-cyan/10 px-3 text-xs font-medium text-accent-cyan hover:bg-accent-cyan/20 transition-colors">
          <Wallet className="h-3.5 w-3.5" />
          Connect Wallet
        </button>

        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-bg-elevated">
          <User className="h-4 w-4 text-text-muted" />
        </div>
      </div>
    </header>
  );
}
