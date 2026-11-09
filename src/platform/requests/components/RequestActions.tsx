"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveToolRequest, refreshToolRequest, retryToolRequestBuild, submitToolRequest } from "../actions";
import { pollShownStatuses } from "../poll";

export function RequestActions({ id, status, canSubmit, canApprove }: { id: string; status: string; canSubmit: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const building = status === "BUILDING" || status === "NEEDS_INPUT" || status === "PR_OPEN";

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error?.message ?? "Failed");
      router.refresh();
    });

  useEffect(() => {
    if (!building) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const round = async () => {
      let stale = false;
      try {
        stale = await pollShownStatuses({ [id]: status }, refreshToolRequest, () => stopped);
      } catch {
        // Retried on the next round.
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
  }, [building, id, status, router]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "DRAFT" && canSubmit ? (
          <Button disabled={pending} onClick={() => run(() => submitToolRequest({ id }))}>
            Submit for approval
          </Button>
        ) : null}
        {status === "SUBMITTED" && canApprove ? (
          <>
            <Input className="w-64" placeholder="Approval note (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button disabled={pending} onClick={() => run(() => approveToolRequest({ id, reason: reason || undefined }))}>
              Approve and start build
            </Button>
          </>
        ) : null}
        {status === "APPROVED" && canApprove ? (
          <Button variant="outline" disabled={pending} onClick={() => run(() => retryToolRequestBuild({ id }))}>
            Retry starting build
          </Button>
        ) : null}
        {building ? (
          <Button variant="outline" disabled={pending} onClick={() => run(() => refreshToolRequest({ id }))}>
            Refresh status
          </Button>
        ) : null}
      </div>
      {building ? <p className="text-xs text-muted-foreground">Polling the Devin session every 5s.</p> : null}
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
