"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function snapshot(): string {
  return window.location.search;
}

export function useQueryParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, snapshot, () => "");
  return new URLSearchParams(search);
}
