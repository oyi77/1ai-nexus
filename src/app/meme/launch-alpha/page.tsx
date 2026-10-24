import { Suspense } from "react";
import { NexusLayout } from "@/components/layout/NexusLayout";
import { MemeLaunchAlphaPageContent } from "./content";

export default function MemeLaunchAlphaPage() {
  return (
    <NexusLayout>
      <Suspense fallback={<div className="p-4 text-xs font-mono text-text-muted">Loading launch alpha...</div>}>
        <MemeLaunchAlphaPageContent />
      </Suspense>
    </NexusLayout>
  );
}
