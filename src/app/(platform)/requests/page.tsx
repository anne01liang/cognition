import Link from "next/link";
import { unwrap } from "@/platform/action";
import { hasPermission } from "@/platform/guard";
import { requirePagePermission } from "@/platform/session";
import { listToolRequests } from "@/platform/requests/actions";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";


function RequestTable({ rows }: { rows: Extract<Awaited<ReturnType<typeof listToolRequests>>, { ok: true }>["data"] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Risk</TableHead>
          <TableHead>Devin session</TableHead>
          <TableHead>PR</TableHead>
          <TableHead>ACUs (used / est.)</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link className="underline" href={`/requests/${r.id}`}>
                {r.toolName}
              </Link>
            </TableCell>
            <TableCell><StatusBadge status={r.status} /></TableCell>
            <TableCell><StatusBadge status={r.riskTier} /></TableCell>
            <TableCell>{r.devinSessionUrl ? <a className="underline" href={r.devinSessionUrl} target="_blank" rel="noreferrer">session</a> : "—"}</TableCell>
            <TableCell>{r.prUrl ? <a className="underline" href={r.prUrl} target="_blank" rel="noreferrer">PR</a> : "—"}</TableCell>
            <TableCell>{r.acusUsed ?? "—"} / {r.estimatedAcus}</TableCell>
            <TableCell>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function MyRequestsPage() {
  const session = await requirePagePermission("tools:request");
  const mine = unwrap(await listToolRequests({ scope: "mine" }));
  const approvals = hasPermission(session, "tools:approve") ? unwrap(await listToolRequests({ scope: "approvals" })) : null;
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My tool requests</h1>
        <Button asChild>
          <Link href="/requests/new">Request a tool</Link>
        </Button>
      </div>
      <RequestTable rows={mine} />
      {approvals ? (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Awaiting approval</h2>
          <RequestTable rows={approvals} />
        </div>
      ) : null}
    </div>
  );
}
