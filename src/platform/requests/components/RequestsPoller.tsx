"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshToolRequest } from "../actions";

/**
 * Polls the Devin sessions of the listed requests and re-renders the page when one changes status.
 * One request at a time, and the next round starts 5s after the previous one finished, so polls never overlap.
 */
export function RequestsPoller({ ids }: { ids: string[] }) {
  const router = useRouter();
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const round = async () => {
      let changed = false;
      try {
        for (const id of key.split(",")) {
          if (stopped) return;
          const res = await refreshToolRequest({ id });
          changed ||= res.ok && res.data.changed;
        }
      } catch {
        // A failed round (e.g. network) is retried on the next one.
      } finally {
        if (!stopped) timer = setTimeout(round, 5000);
      }
      if (changed && !stopped) router.refresh();
    };
    timer = setTimeout(round, 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [key, router]);
  return null;
}
