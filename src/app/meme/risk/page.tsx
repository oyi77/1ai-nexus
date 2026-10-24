import { Suspense } from "react";
import { NexusLayout } from "@/components/layout/NexusLayout";
import { MemeRiskPageContent } from "./content";

export default function MemeRiskPage() {
  return (
    <NexusLayout>
      <Suspense fallback={<div className="p-4 text-xs font-mono text-text-muted">Loading risk audit...</div>}>
        <MemeRiskPageContent />
      </Suspense>
    </NexusLayout>
  );
}
