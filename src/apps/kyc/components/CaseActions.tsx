"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { decideCase, resolveEscalation, submitCase } from "../actions";

interface Props {
  id: string;
  status: string;
  canSubmit: boolean;
  canDecide: boolean;
  canResolve: boolean;
}

/** Buttons are hidden when the user lacks permission; the server re-checks everything. */
export function CaseActions({ id, canSubmit, canDecide, canResolve }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error?.message ?? "Failed");
      else router.refresh();
    });

  if (!canSubmit && !canDecide && !canResolve) return null;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {canSubmit ? (
        <Button disabled={pending} onClick={() => run(() => submitCase({ id }))}>
          Submit for approval
        </Button>
      ) : null}
      {canDecide || canResolve ? (
        <>
          <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button
              disabled={pending}
              onClick={() => run(() => (canDecide ? decideCase : resolveEscalation)({ id, decision: "APPROVE", reason }))}
            >
              Approve
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => run(() => (canDecide ? decideCase : resolveEscalation)({ id, decision: "REJECT", reason }))}
            >
              Reject
            </Button>
            {canDecide ? (
              <Button variant="outline" disabled={pending} onClick={() => run(() => decideCase({ id, decision: "ESCALATE", reason }))}>
                Escalate
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
