import { requirePagePermission } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { unwrap } from "@/platform/action";
import { firstValues } from "@/platform/table";
import { DataTable } from "@/components/platform/DataTable";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { listQueue } from "../actions";
import { KYC_REVIEW } from "../permissions";
import { formatUtc, riskBand } from "../rules";
import { CASE_STATUSES, COUNTRIES } from "../schemas";

export default async function QueuePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await requirePagePermission(KYC_REVIEW.queue);
  const raw = firstValues(searchParams);
  raw.view ??= hasPermission(session, KYC_REVIEW.review) ? "queue" : "approvals";
  await requirePagePermission(raw.view === "approvals" ? KYC_REVIEW.approve : KYC_REVIEW.review);
  const page = unwrap(await listQueue(raw));
  const approvals = page.params.view === "approvals";
  const countryFilter = { name: "country", label: "Countries", options: COUNTRIES };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{approvals ? "Awaiting second review" : "KYC review queue"}</h1>
        <p className="text-sm text-muted-foreground">
          {approvals
            ? "Recommendations from other analysts that need a kyc:approve decision."
            : "Unassigned cases and cases assigned to you. Open cases past their 48h SLA are highlighted."}
        </p>
      </div>
      <DataTable
        basePath="/apps/kyc-review"
        params={page.params}
        rows={page.rows}
        total={page.total}
        filters={approvals ? [countryFilter] : [{ name: "status", label: "Statuses", options: CASE_STATUSES }, countryFilter]}
        filterValues={{ view: page.params.view, status: page.params.status, country: page.params.country }}
        rowHref={(r) => `/apps/kyc-review/${r.id}`}
        rowClassName={(r) => (r.slaBreached ? "bg-red-50 hover:bg-red-100" : undefined)}
        searchPlaceholder="Case id"
        columns={[
          { key: "customerName", header: "Customer" },
          { key: "country", header: "Country" },
          {
            key: "riskScore",
            header: "Risk",
            sortable: true,
            cell: (r) => (
              <span className="inline-flex items-center gap-2">
                <span className="w-6 text-right tabular-nums">{r.riskScore}</span> <StatusBadge status={riskBand(r.riskScore)} />
              </span>
            ),
          },
          { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          {
            key: "assignedTo",
            header: "Assignee",
            cell: (r) => (r.assignedTo === null ? "Unassigned" : r.assignedTo === session.userId ? "Me" : "Another analyst"),
          },
          { key: "recommendation", header: "Recommendation", cell: (r) => r.recommendation ?? "—" },
          {
            key: "slaDueAt",
            header: "SLA due",
            sortable: true,
            cell: (r) => (
              <span className={r.slaBreached ? "font-medium text-red-700" : ""}>
                {formatUtc(r.slaDueAt)}
                {r.slaBreached ? " · SLA breached" : ""}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
