"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshToolRequest } from "../actions";
import { pollShownStatuses } from "../poll";

/**
 * Polls the Devin sessions of the listed requests and re-renders the page when the server's status differs from the one shown.
 * One request at a time, and the next round starts 5s after the previous one finished, so polls never overlap.
 */
export function RequestsPoller({ requests }: { requests: { id: string; status: string }[] }) {
  const router = useRouter();
  const key = JSON.stringify(requests.map((r) => [r.id, r.status]));
  useEffect(() => {
    const shown: Record<string, string> = Object.fromEntries(JSON.parse(key));
    if (Object.keys(shown).length === 0) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const round = async () => {
      let stale = false;
      try {
        stale = await pollShownStatuses(shown, refreshToolRequest, () => stopped);
      } catch {
        // A failed round (e.g. network) is retried on the next one.
      } finally {
        if (!stopped) timer = setTimeout(round, 5000);
      }
      if (stale && !stopped) router.refresh();
    };
    timer = setTimeout(round, 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [key, router]);
  return null;
}
