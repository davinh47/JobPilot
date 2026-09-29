"use client";

import { useEffect, useRef } from "react";

/** Keep the compact list/detail transition in the same reading context. */
export function DiscoveryNavigation({ detailJobId }: { detailJobId: string | null }) {
  const previousJobId = useRef<string | null>(null);

  useEffect(() => {
    const returnJobId = previousJobId.current;
    previousJobId.current = detailJobId;
    if (!window.matchMedia("(max-width: 999px)").matches) return;

    const frame = requestAnimationFrame(() => {
      if (detailJobId) {
        window.scrollTo({ top: 0, behavior: "instant" });
        document.getElementById("discovery-detail-title")?.focus({ preventScroll: true });
      } else if (returnJobId) {
        const row = document.getElementById(`discovery-job-${returnJobId}`);
        row?.scrollIntoView({ block: "center", behavior: "instant" });
        row?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [detailJobId]);

  return null;
}
