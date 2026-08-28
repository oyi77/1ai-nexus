import { Suspense } from "react";
import { MemeRiskPageContent } from "./content";
export default function MemeRiskPage() {
  return (
    <Suspense fallback={null}>
      <MemeRiskPageContent />
    </Suspense>
  );
}
