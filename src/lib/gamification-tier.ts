// §3 — Gamification tier math (pure, no DB/prisma dependency)
// Safe to import from client components (top-bar pill, account page).

export type TierName = "Bronze" | "Silver" | "Gold" | "Platinum";

export interface TierInfo {
  tier: TierName;
  level: number;
  xp: number;
  nextTierXp: number | null;
  /** 0..1 progress toward the next tier (1 when at Platinum) */
  progress: number;
}

const TIER_CEILINGS: Array<{ tier: TierName; ceil: number }> = [
  { tier: "Bronze", ceil: 500 },
  { tier: "Silver", ceil: 1500 },
  { tier: "Gold", ceil: 4000 },
  { tier: "Platinum", ceil: Infinity },
];

export function computeTier(xp: number): TierInfo {
  const safeXp = Math.max(0, Math.floor(xp));
  let tier: TierName = "Bronze";
  let floor = 0;
  let ceil: number | null = 500;
  for (const step of TIER_CEILINGS) {
    if (safeXp < step.ceil) {
      tier = step.tier;
      ceil = step.ceil === Infinity ? null : step.ceil;
      break;
    }
    floor = step.ceil;
  }
  const level = Math.floor(safeXp / 250) + 1;
  const progress =
    ceil === null ? 1 : Math.max(0, Math.min(1, (safeXp - floor) / (ceil - floor)));
  return { tier, level, xp: safeXp, nextTierXp: ceil, progress };
}
