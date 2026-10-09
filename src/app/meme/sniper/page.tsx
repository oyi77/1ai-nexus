import { Suspense } from "react";
import { NexusLayout } from '@/components/layout/NexusLayout';
import { MemeSniperPageContent } from "./content";

export default function MemeSniperPage() {
  return (
    <NexusLayout>
      <Suspense fallback={null}>
        <MemeSniperPageContent />
      </Suspense>
    </NexusLayout>
  );
}
