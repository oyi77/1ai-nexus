import { Suspense } from "react";
import { NexusLayout } from "@/components/layout/NexusLayout";
import { MemeLeaderboardPageContent } from "./content";

export default function MemeLeaderboardPage() {
  return (
    <NexusLayout>
      <Suspense fallback={<div className="p-4 text-xs font-mono text-text-muted">Loading leaderboard...</div>}>
        <MemeLeaderboardPageContent />
      </Suspense>
    </NexusLayout>
  );
}
