import { prisma } from "@/lib/db";
import { TierName, TierInfo, computeTier } from "./gamification-tier";
export type { TierName, TierInfo } from "./gamification-tier";
export { computeTier } from "./gamification-tier";

export type GamificationAction =
  | "CONNECT_EXCHANGE"
  | "SAVE_WATCHLIST"
  | "RUN_SCAN"
  | "RUN_REPORT"
  | "DAILY_STREAK"
  | "INVITE";

const ACTION_XP: Record<GamificationAction, number> = {
  CONNECT_EXCHANGE: 50,
  SAVE_WATCHLIST: 5,
  RUN_SCAN: 10,
  RUN_REPORT: 10,
  DAILY_STREAK: 15,
  INVITE: 100,
};



export interface AwardResult {
  awarded: boolean;
  xp: number;
  totalXp: number;
  level: number;
  action: GamificationAction;
  refId: string;
  eventId: string | null;
}

function isUniqueViolation(e: unknown): boolean {
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as { code?: unknown }).code;
    return code === "P2002" || code === "23505";
  }
  return false;
}

/**
 * Award XP for a gamification action. Idempotent per (userId, action, refId):
 * a duplicate (P2002 / SQLSTATE 23505) returns the existing award state without
 * throwing or double-counting.
 */
export async function awardXp(
  userId: string,
  action: GamificationAction,
  refId: string
): Promise<AwardResult> {
  const xpDelta = ACTION_XP[action];
  try {
    const ev = await prisma.userEvent.create({
      data: { userId, action, refId, xpDelta },
    });
    const user = await prisma.user.update({
      where: { id: userId },
      data: { xp: { increment: xpDelta }, level: computeTier(xpDelta).level },
      select: { xp: true, level: true },
    });
    // level must reflect the *new* total xp, not the delta
    const level = computeTier(user.xp).level;
    if (level !== user.level) {
      await prisma.user.update({
        where: { id: userId },
        data: { level },
        select: { id: true },
      });
    }
    return {
      awarded: true,
      xp: xpDelta,
      totalXp: user.xp,
      level,
      action,
      refId,
      eventId: ev.id,
    };
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      const existing = await prisma.userEvent.findFirst({
        where: { userId, action, refId },
        select: { id: true },
      });
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { xp: true, level: true },
      });
      return {
        awarded: false,
        xp: 0,
        totalXp: user?.xp ?? 0,
        level: user?.level ?? 1,
        action,
        refId,
        eventId: existing?.id ?? null,
      };
    }
    throw e;
  }
}

export interface UserGamification {
  xp: number;
  level: number;
  tier: TierName;
  nextTierXp: number | null;
  progress: number;
  badges: Array<{ badgeId: string; awardedAt: string }>;
  recent: Array<{ action: string; xpDelta: number; refId: string; createdAt: string }>;
}

export async function getUserGamification(userId: string): Promise<UserGamification> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { xp: true, level: true },
  });
  const xp = user?.xp ?? 0;
  const info = computeTier(xp);
  const [badges, recent] = await Promise.all([
    prisma.userBadge.findMany({
      where: { userId },
      orderBy: { awardedAt: "desc" },
      select: { badgeId: true, awardedAt: true },
    }),
    prisma.userEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { action: true, xpDelta: true, refId: true, createdAt: true },
    }),
  ]);
  return {
    xp,
    level: user?.level ?? info.level,
    tier: info.tier,
    nextTierXp: info.nextTierXp,
    progress: info.progress,
    badges: badges.map((b) => ({ badgeId: b.badgeId, awardedAt: b.awardedAt.toISOString() })),
    recent: recent.map((r) => ({
      action: r.action,
      xpDelta: r.xpDelta,
      refId: r.refId,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
