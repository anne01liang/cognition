"use client";

import { useState, useTransition } from "react";
import { revealPii } from "@/platform/pii/actions";
import { Button } from "@/components/ui/button";

export function RevealButton(props: { masked: string; entityType: string; entityId: string; field: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <span>{value ?? props.masked}</span>
      {value === null ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await revealPii({ entityType: props.entityType, entityId: props.entityId, field: props.field });
              if (res.ok) {
                setValue(res.data.value);
                setTimeout(() => setValue(null), 30_000);
              } else setError(res.error.message);
            })
          }
        >
          {pending ? "…" : "Reveal"}
        </Button>
      ) : (
        <Button type="button" variant="link" size="sm" onClick={() => setValue(null)}>
          Hide
        </Button>
      )}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </>
  );
}
