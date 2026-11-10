"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { submitVisitNote } from "../actions";

/** Shown only to users with visitor_log:write; the server re-checks. */
export function SubmitVisitNoteButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await submitVisitNote({ id });
            if (!res.ok) setError(res.error.message);
            else router.refresh();
          })
        }
      >
        Submit
      </Button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
