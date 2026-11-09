"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { claimCase, finalizeCase, recommendCase } from "../actions";

interface Props {
  id: string;
  canClaim: boolean;
  canRecommend: boolean;
  canFinalize: boolean;
  highRisk: boolean;
}

type Result = { ok: true } | { ok: false; error: { message: string; fieldErrors?: Record<string, string[]> } };

/** Buttons are hidden when the user lacks permission; the server re-checks everything. */
export function ReviewActions({ id, canClaim, canRecommend, canFinalize, highRisk }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error.fieldErrors?.reason?.[0] ?? res.error.message);
      else {
        setReason("");
        router.refresh();
      }
    });

  if (!canClaim && !canRecommend && !canFinalize) return null;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {canClaim ? (
        <Button disabled={pending} onClick={() => run(() => claimCase({ id }))}>
          Claim case
        </Button>
      ) : null}
      {canRecommend || canFinalize ? (
        <>
          <p className="text-sm text-muted-foreground">
            {canFinalize
              ? "Second review: your decision is final. You cannot finalize a case you recommended."
              : highRisk
                ? "Risk score ≥ 70: every recommendation goes to a second reviewer with kyc:approve."
                : "APPROVE and ESCALATE go to a second reviewer with kyc:approve. REJECT is final."}
          </p>
          <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            {canRecommend ? (
              <>
                <Button disabled={pending} onClick={() => run(() => recommendCase({ id, recommendation: "APPROVE", reason }))}>
                  Recommend approve
                </Button>
                <Button variant="destructive" disabled={pending} onClick={() => run(() => recommendCase({ id, recommendation: "REJECT", reason }))}>
                  Recommend reject
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => run(() => recommendCase({ id, recommendation: "ESCALATE", reason }))}>
                  Escalate
                </Button>
              </>
            ) : (
              <>
                <Button disabled={pending} onClick={() => run(() => finalizeCase({ id, decision: "APPROVE", reason }))}>
                  Approve
                </Button>
                <Button variant="destructive" disabled={pending} onClick={() => run(() => finalizeCase({ id, decision: "REJECT", reason }))}>
                  Reject
                </Button>
              </>
            )}
          </div>
        </>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
