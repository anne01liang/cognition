"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshToolRequest } from "../actions";

/** Polls the Devin sessions of the listed requests every 5s and re-renders the page when one changes status. */
export function RequestsPoller({ ids }: { ids: string[] }) {
  const router = useRouter();
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    const t = setInterval(async () => {
      const results = await Promise.all(key.split(",").map((id) => refreshToolRequest({ id })));
      if (results.some((res) => res.ok && res.data.changed)) router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [key, router]);
  return null;
}
