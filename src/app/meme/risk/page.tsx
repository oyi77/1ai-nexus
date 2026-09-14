import { Suspense } from "react";
import { NexusLayout } from '@/components/layout/NexusLayout';
import { MemeRiskPageContent } from "./content";
export default function MemeRiskPage() {
  return (
    <NexusLayout>
      <Suspense fallback={null}>
        <MemeRiskPageContent />
      </Suspense>
    </NexusLayout>
  );
}
