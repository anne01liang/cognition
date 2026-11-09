"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { createToolRequest } from "../actions";
import {
  FIELD_TYPES,
  ROLE_NAMES,
  formToManifest,
  manifestToYaml,
  parseManifestYaml,
  summarizeManifest,
  toolRequestFormSchema,
} from "../manifest";

type FieldDraft = { name: string; type: (typeof FIELD_TYPES)[number]; pii: boolean; money: boolean };
type EntityDraft = { name: string; fields: FieldDraft[] };
type RuleDraft = { entity: string; field: string; threshold: string; approverRole: string };

const emptyField = (): FieldDraft => ({ name: "", type: "string", pii: false, money: false });

function RoleChecks({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {ROLE_NAMES.map((r) => (
          <label key={r} className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
            {r}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function RequestForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [primaryUsers, setPrimaryUsers] = useState<string[]>([]);
  const [readOnlyRoles, setReadOnlyRoles] = useState<string[]>([]);
  const [entities, setEntities] = useState<EntityDraft[]>([{ name: "", fields: [emptyField()] }]);
  const [states, setStates] = useState("DRAFT, SUBMITTED, APPROVED, REJECTED");
  const [rule, setRule] = useState<RuleDraft | null>(null);
  const [yamlText, setYamlText] = useState<string | null>(null); // null = follow the form
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const formInput = useMemo(
    () => ({
      name,
      purpose,
      primaryUsers,
      readOnlyRoles,
      entities,
      workflowStates: states.split(",").map((s) => s.trim()).filter(Boolean),
      approvalRule: rule ? { ...rule, threshold: Number(rule.threshold) } : null,
    }),
    [name, purpose, primaryUsers, readOnlyRoles, entities, states, rule],
  );
  const form = toolRequestFormSchema.safeParse(formInput);
  const generatedYaml = form.success ? manifestToYaml(formToManifest(form.data)) : "";
  const shownYaml = yamlText ?? generatedYaml;
  const manifest = shownYaml ? parseManifestYaml(shownYaml) : null;

  const updateEntity = (i: number, patch: Partial<EntityDraft>) => setEntities((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const updateField = (i: number, k: number, patch: Partial<FieldDraft>) =>
    updateEntity(i, { fields: entities[i]!.fields.map((f, j) => (j === k ? { ...f, ...patch } : f)) });

  const save = () =>
    startTransition(async () => {
      setServerError(null);
      if (!form.success || !manifest?.ok) return;
      const res = await createToolRequest({ form: form.data, manifestYaml: shownYaml });
      if (res.ok) router.push(`/requests/${res.data.id}`);
      else setServerError([...new Set([res.error.message, ...Object.values(res.error.fieldErrors ?? {}).flat()])].join(" "));
    });

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-5">
        <div className="space-y-1">
          <Label htmlFor="name">Tool name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Refund Requests" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="purpose">Purpose</Label>
          <Textarea id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Support agents request refunds; finance approves large ones." />
        </div>
        <RoleChecks label="Primary users (can create and edit)" value={primaryUsers} onChange={setPrimaryUsers} />
        <RoleChecks label="Read-only roles" value={readOnlyRoles} onChange={setReadOnlyRoles} />

        <div className="space-y-3">
          <div className="text-sm font-medium">Entities</div>
          {entities.map((e, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex gap-2">
                <Input aria-label={`Entity ${i + 1} name`} value={e.name} onChange={(ev) => updateEntity(i, { name: ev.target.value })} placeholder="Refund" />
                {entities.length > 1 ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setEntities(entities.filter((_, j) => j !== i))}>
                    Remove entity
                  </Button>
                ) : null}
              </div>
              {e.fields.map((f, k) => (
                <div key={k} className="flex flex-wrap items-center gap-2">
                  <Input className="w-40" aria-label="Field name" value={f.name} onChange={(ev) => updateField(i, k, { name: ev.target.value })} placeholder="customerEmail" />
                  <Select className="w-28" aria-label="Field type" value={f.type} onChange={(ev) => updateField(i, k, { type: ev.target.value as FieldDraft["type"] })}>
                    {FIELD_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={f.pii} onChange={(ev) => updateField(i, k, { pii: ev.target.checked })} />@pii
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={f.money} onChange={(ev) => updateField(i, k, { money: ev.target.checked })} />@money
                  </label>
                  {e.fields.length > 1 ? (
                    <button type="button" className="text-xs text-muted-foreground underline" onClick={() => updateEntity(i, { fields: e.fields.filter((_, j) => j !== k) })}>
                      remove
                    </button>
                  ) : null}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => updateEntity(i, { fields: [...e.fields, emptyField()] })}>
                Add field
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setEntities([...entities, { name: "", fields: [emptyField()] }])}>
            Add entity
          </Button>
        </div>

        <div className="space-y-1">
          <Label htmlFor="states">Workflow states (comma-separated, first is initial)</Label>
          <Input id="states" value={states} onChange={(e) => setStates(e.target.value)} />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={!!rule} onChange={(e) => setRule(e.target.checked ? { entity: entities[0]?.name ?? "", field: "", threshold: "500", approverRole: "finance_approver" } : null)} />
            Approval rule
          </label>
          {rule ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Select className="w-32" aria-label="Rule entity" value={rule.entity} onChange={(e) => setRule({ ...rule, entity: e.target.value })}>
                <option value="">entity…</option>
                {entities.map((e) => e.name).filter(Boolean).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
              <Select className="w-36" aria-label="Rule field" value={rule.field} onChange={(e) => setRule({ ...rule, field: e.target.value })}>
                <option value="">field…</option>
                {(entities.find((e) => e.name === rule.entity)?.fields ?? []).map((f) => f.name).filter(Boolean).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
              over
              <Input className="w-24" aria-label="Threshold" type="number" min={0} value={rule.threshold} onChange={(e) => setRule({ ...rule, threshold: e.target.value })} />
              requires
              <Select className="w-40" aria-label="Approver role" value={rule.approverRole} onChange={(e) => setRule({ ...rule, approverRole: e.target.value })}>
                {ROLE_NAMES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>

        {!form.success ? (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {form.error.issues.slice(0, 8).map((i, n) => (
              <li key={n}>
                {i.path.join(".")}: {i.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="manifest">Manifest (YAML, editable)</Label>
          {yamlText !== null ? (
            <button type="button" className="text-xs underline" onClick={() => setYamlText(null)}>
              Regenerate from form
            </button>
          ) : null}
        </div>
        <Textarea
          id="manifest"
          className="h-96 font-mono text-xs"
          value={shownYaml}
          placeholder="Fill in the form; the manifest is generated here."
          onChange={(e) => setYamlText(e.target.value)}
        />
        {manifest ? (
          manifest.ok ? (
            <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm" data-testid="manifest-valid">
              <div className="flex items-center gap-2 font-medium">
                Valid manifest <StatusBadge status={manifest.manifest.riskTier} />
              </div>
              <p>{summarizeManifest(manifest.manifest)}</p>
            </div>
          ) : (
            <ul className="list-disc space-y-0.5 rounded-md border border-red-300 bg-red-50 p-3 pl-7 text-xs text-red-800" data-testid="manifest-errors">
              {manifest.errors.map((e, n) => (
                <li key={n}>{e}</li>
              ))}
            </ul>
          )
        ) : null}
        {serverError ? <p className="text-sm text-red-700">{serverError}</p> : null}
        <Button type="button" disabled={pending || !form.success || !manifest?.ok} onClick={save}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}
