import Link from "next/link";
import { requirePagePermission } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { unwrap } from "@/platform/action";
import { firstValues } from "@/platform/table";
import { DataTable } from "@/components/platform/DataTable";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { Button } from "@/components/ui/button";
import { listRefunds } from "../actions";
import { REFUND } from "../permissions";
import { REFUND_STATUSES } from "../schemas";
import { formatMoney } from "../money";

export default async function RefundListPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await requirePagePermission(REFUND.read);
  const page = unwrap(await listRefunds(firstValues(searchParams)));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Refunds</h1>
        {hasPermission(session, REFUND.request) ? (
          <Button asChild>
            <Link href="/apps/refunds/new">Request refund</Link>
          </Button>
        ) : null}
      </div>
      <DataTable
        basePath="/apps/refunds"
        params={page.params}
        rows={page.rows}
        total={page.total}
        filters={[{ name: "status", label: "Statuses", options: REFUND_STATUSES }]}
        filterValues={{ status: page.params.status }}
        rowHref={(r) => `/apps/refunds/${r.id}`}
        columns={[
          { key: "customerName", header: "Customer" },
          { key: "accountNumber", header: "Account" },
          { key: "amountCents", header: "Amount", sortable: true, cell: (r) => formatMoney(r.amountCents, r.currency) },
          { key: "status", header: "Status", sortable: true, cell: (r) => <StatusBadge status={r.status} /> },
          { key: "createdAt", header: "Created", sortable: true, cell: (r) => r.createdAt.toISOString().slice(0, 10) },
        ]}
      />
    </div>
  );
}
