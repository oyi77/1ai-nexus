import { Suspense } from "react";
import { NexusLayout } from "@/components/layout/NexusLayout";
import { MemeIndexPageContent } from "./content";

export default function MemeIndexPage() {
  return (
    <NexusLayout>
      <Suspense fallback={<div className="p-4 text-xs font-mono text-text-muted">Loading meme alpha...</div>}>
        <MemeIndexPageContent />
      </Suspense>
    </NexusLayout>
  );
}
