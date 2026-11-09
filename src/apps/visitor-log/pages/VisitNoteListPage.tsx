import Link from "next/link";
import { requirePagePermission } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { unwrap } from "@/platform/action";
import { firstValues } from "@/platform/table";
import { DataTable } from "@/components/platform/DataTable";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { Button } from "@/components/ui/button";
import { listVisitNotes } from "../actions";
import { VISITOR_LOG } from "../permissions";
import { VISIT_NOTE_STATUSES } from "../schemas";

export default async function VisitNoteListPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await requirePagePermission(VISITOR_LOG.read);
  const page = unwrap(await listVisitNotes(firstValues(searchParams)));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Visit notes</h1>
        {hasPermission(session, VISITOR_LOG.write) ? (
          <Button asChild>
            <Link href="/apps/visitor-log/new">New note</Link>
          </Button>
        ) : null}
      </div>
      <DataTable
        basePath="/apps/visitor-log"
        params={page.params}
        rows={page.rows}
        total={page.total}
        filters={[{ name: "status", label: "Statuses", options: VISIT_NOTE_STATUSES }]}
        filterValues={{ status: page.params.status }}
        rowHref={(r) => `/apps/visitor-log/${r.id}`}
        searchPlaceholder="Search room label or note id"
        columns={[
          { key: "roomLabel", header: "Room", sortable: true },
          { key: "note", header: "Note" },
          { key: "status", header: "Status", sortable: true, cell: (r) => <StatusBadge status={r.status} /> },
          { key: "createdAt", header: "Created", sortable: true, cell: (r) => r.createdAt.toISOString().slice(0, 10) },
        ]}
      />
    </div>
  );
}
