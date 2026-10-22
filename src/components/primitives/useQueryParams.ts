"use client";

import { useEffect, useState } from "react";

function readSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

export function useQueryParams(): URLSearchParams {
  const [search, setSearch] = useState(readSearch);

  useEffect(() => {
    const sync = () => setSearch(readSearch());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return new URLSearchParams(search);
}
