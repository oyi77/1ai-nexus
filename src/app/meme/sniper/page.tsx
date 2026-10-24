import { Suspense } from "react";
import { NexusLayout } from "@/components/layout/NexusLayout";
import { MemeSniperPageContent } from "./content";

export default function MemeSniperPage() {
  return (
    <NexusLayout>
      <Suspense fallback={<div className="p-4 text-xs font-mono text-text-muted">Loading sniper terminal...</div>}>
        <MemeSniperPageContent />
      </Suspense>
    </NexusLayout>
  );
}
