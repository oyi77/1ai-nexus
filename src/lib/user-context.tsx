"use client";

import { createContext, useContext, type ReactNode } from "react";
import { computeTier, type TierName } from "./gamification-tier";

export interface CurrentUser {
  xp: number;
  level: number;
  plan: string | null;
  tier: TierName;
}

const UserContext = createContext<CurrentUser | null>(null);

export function UserProvider({
  user,
  children,
}: {
  user: CurrentUser | null;
  children: ReactNode;
}) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser(): CurrentUser | null {
  return useContext(UserContext);
}

export function useUserTier(xp: number): TierName {
  return computeTier(xp).tier;
}
