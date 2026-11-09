import Link from "next/link";
import { requirePagePermission } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { unwrap } from "@/platform/action";
import { firstValues } from "@/platform/table";
import { DataTable } from "@/components/platform/DataTable";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { Button } from "@/components/ui/button";
import { listCases } from "../actions";
import { KYC } from "../permissions";
import { CASE_STATUSES } from "../schemas";

export default async function CaseListPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await requirePagePermission(KYC.read);
  const raw = firstValues(searchParams);
  const page = unwrap(await listCases(raw));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">KYC cases</h1>
        {hasPermission(session, KYC.create) ? (
          <Button asChild>
            <Link href="/apps/kyc/new">New case</Link>
          </Button>
        ) : null}
      </div>
      <DataTable
        basePath="/apps/kyc"
        params={page.params}
        rows={page.rows}
        total={page.total}
        filters={[{ name: "status", label: "Statuses", options: CASE_STATUSES }]}
        filterValues={{ status: page.params.status }}
        rowHref={(r) => `/apps/kyc/${r.id}`}
        searchPlaceholder="Search customer or case id"
        columns={[
          { key: "customerName", header: "Customer" },
          { key: "documentNumber", header: "Document" },
          { key: "country", header: "Country" },
          { key: "riskLevel", header: "Risk", sortable: true, cell: (r) => <StatusBadge status={r.riskLevel} /> },
          { key: "status", header: "Status", sortable: true, cell: (r) => <StatusBadge status={r.status} /> },
          { key: "createdAt", header: "Created", sortable: true, cell: (r) => r.createdAt.toISOString().slice(0, 10) },
        ]}
      />
    </div>
  );
}
