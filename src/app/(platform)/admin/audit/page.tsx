import { requirePagePermission } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { verifyAuditChain } from "@/platform/audit";
import { auditQuerySchema, queryAuditEvents } from "@/platform/audit-query";
import { firstValues } from "@/platform/table";
import { db } from "@/platform/db";
import { DataTable } from "@/components/platform/DataTable";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await requirePagePermission("audit:read");
  const raw = firstValues(searchParams);
  const parsed = auditQuerySchema.safeParse(raw);
  const input = parsed.success ? parsed.data : auditQuerySchema.parse({});
  const page = await queryAuditEvents(input);
  const verify = hasPermission(session, "audit:verify") ? await verifyAuditChain(db) : null;
  const filterValues = { actor: input.actor, entityType: input.entityType, entityId: input.entityId, from: input.from, to: input.to };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        {verify ? (
          verify.ok ? (
            <Badge variant="success">Chain verified · {verify.checked} events</Badge>
          ) : (
            <Badge variant="destructive">CHAIN BROKEN at seq {verify.firstBrokenSeq} ({verify.checked} ok before it)</Badge>
          )
        ) : null}
      </div>

      <form method="GET" action="/admin/audit" className="flex flex-wrap items-end gap-2 rounded-md border p-3 text-sm">
        <Input name="actor" placeholder="Actor (username)" defaultValue={input.actor ?? ""} className="w-40" />
        <Input name="entityType" placeholder="Entity type" defaultValue={input.entityType ?? ""} className="w-36" />
        <Input name="entityId" placeholder="Entity id" defaultValue={input.entityId ?? ""} className="w-56" />
        <label className="flex items-center gap-1">From <Input type="date" name="from" defaultValue={input.from ?? ""} className="w-40" /></label>
        <label className="flex items-center gap-1">To <Input type="date" name="to" defaultValue={input.to ?? ""} className="w-40" /></label>
        <Button type="submit" variant="outline">Filter</Button>
      </form>

      <DataTable
        basePath="/admin/audit"
        params={page.params}
        rows={page.rows}
        total={page.total}
        filterValues={filterValues}
        searchPlaceholder="Search action, e.g. pii.reveal"
        columns={[
          { key: "seq", header: "Seq", sortable: true },
          { key: "createdAt", header: "When (UTC)", sortable: true, cell: (r) => r.createdAt.toISOString().replace("T", " ").slice(0, 19) },
          { key: "actor", header: "Actor" },
          { key: "action", header: "Action", sortable: true, cell: (r) => <code>{r.action}</code> },
          { key: "entityType", header: "Entity", sortable: true, cell: (r) => `${r.entityType}:${r.entityId.slice(0, 10)}` },
          { key: "reason", header: "Reason", cell: (r) => r.reason ?? "" },
          {
            key: "diff",
            header: "After",
            cell: (r) => <code className="block max-w-xs truncate text-xs" title={JSON.stringify(r.after)}>{JSON.stringify(r.after)}</code>,
          },
          { key: "hash", header: "Hash", cell: (r) => <code className="text-xs">{r.hash.slice(0, 10)}…</code> },
        ]}
      />
    </div>
  );
}
