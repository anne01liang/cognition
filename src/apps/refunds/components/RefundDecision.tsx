"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { decideRefund } from "../actions";

export function RefundDecision({ id, allowEscalate }: { id: string; allowEscalate: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "APPROVE" | "REJECT" | "ESCALATE") =>
    start(async () => {
      const res = await decideRefund({ id, decision, reason });
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => decide("APPROVE")}>Approve</Button>
        <Button variant="destructive" disabled={pending} onClick={() => decide("REJECT")}>Reject</Button>
        {allowEscalate ? <Button variant="outline" disabled={pending} onClick={() => decide("ESCALATE")}>Escalate</Button> : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
