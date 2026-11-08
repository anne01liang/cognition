"use client";

import { useState, useTransition } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/platform/action";

type FieldKind = { kind: "text" | "textarea" | "number" | "checkbox" } | { kind: "select"; options: string[] };

export interface FieldOverrides {
  label?: string;
  textarea?: boolean;
  placeholder?: string;
}

/** Derives an input type from a Zod v4 schema node. */
export function fieldKind(schema: z.ZodType): FieldKind & { optional: boolean } {
  let node: z.ZodType = schema;
  let optional = false;
  for (;;) {
    if (node instanceof z.ZodOptional || node instanceof z.ZodNullable) {
      optional = true;
      node = node.unwrap() as z.ZodType;
    } else if (node instanceof z.ZodDefault) {
      optional = true;
      node = node.unwrap() as z.ZodType;
    } else break;
  }
  if (node instanceof z.ZodEnum) return { kind: "select", options: node.options.map(String), optional };
  if (node instanceof z.ZodNumber) return { kind: "number", optional };
  if (node instanceof z.ZodBoolean) return { kind: "checkbox", optional };
  return { kind: "text", optional };
}

interface FormBuilderProps<S extends z.ZodObject, R> {
  schema: S;
  action: (input: z.input<S>) => Promise<ActionResult<R>>;
  fields?: Partial<Record<keyof z.infer<S> & string, FieldOverrides>>;
  submitLabel?: string;
  onSuccess?: (data: R) => void;
}

/**
 * Renders a form from a Zod object schema. Validates on the client for UX;
 * the server action re-validates with the SAME schema (source of truth).
 */
export function FormBuilder<S extends z.ZodObject, R>({ schema, action, fields = {}, submitLabel = "Submit", onSuccess }: FormBuilderProps<S, R>) {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shape = schema.shape as Record<string, z.ZodType>;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw: Record<string, unknown> = {};
    for (const [name, node] of Object.entries(shape)) {
      const k = fieldKind(node);
      const v = fd.get(name);
      if (k.kind === "checkbox") raw[name] = v === "on";
      else if (v === null || v === "") raw[name] = undefined;
      else if (k.kind === "number") raw[name] = Number(v);
      else raw[name] = String(v);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const fe: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) (fe[String(issue.path[0] ?? "_form")] ??= []).push(issue.message);
      setErrors(fe);
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = await action(raw as z.input<S>);
      if (res.ok) onSuccess?.(res.data);
      else {
        setFormError(res.error.message);
        setErrors(res.error.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4" noValidate>
      {Object.entries(shape).map(([name, node]) => {
        const k = fieldKind(node);
        const o: FieldOverrides = (fields as Record<string, FieldOverrides>)[name] ?? {};
        const label = o.label ?? node.description ?? name;
        const id = `field-${name}`;
        return (
          <div key={name} className="space-y-1.5">
            <Label htmlFor={id}>
              {label}
              {k.optional ? <span className="text-muted-foreground"> (optional)</span> : null}
            </Label>
            {k.kind === "select" ? (
              <Select id={id} name={name} defaultValue="">
                <option value="" disabled>
                  Select…
                </option>
                {k.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            ) : k.kind === "checkbox" ? (
              <input id={id} name={name} type="checkbox" className="h-4 w-4" />
            ) : o.textarea ? (
              <Textarea id={id} name={name} placeholder={o.placeholder} />
            ) : (
              <Input id={id} name={name} type={k.kind === "number" ? "number" : "text"} placeholder={o.placeholder} />
            )}
            {errors[name]?.map((m) => (
              <p key={m} className="text-xs text-red-600">
                {m}
              </p>
            ))}
          </div>
        );
      })}
      {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
