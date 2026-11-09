import { notFound } from "next/navigation";
import { hasPermission } from "@/platform/guard";
import { requirePagePermission } from "@/platform/session";
import { getToolRequest } from "@/platform/requests/actions";
import { parseManifestYaml, summarizeManifest } from "@/platform/requests/manifest";
import { RequestActions } from "@/platform/requests/components/RequestActions";
import { DetailPanel } from "@/components/platform/DetailPanel";
import { StatusBadge } from "@/components/platform/StatusBadge";

const LIFECYCLE = ["DRAFT", "SUBMITTED", "APPROVED", "BUILDING", "PR_OPEN", "MERGED"];

export default async function ToolRequestPage({ params }: { params: { id: string } }) {
  const session = await requirePagePermission("tools:request");
  const res = await getToolRequest({ id: params.id });
  if (!res.ok) notFound();
  const r = res.data;
  const parsed = parseManifestYaml(r.manifestYaml);
  const link = (url: string | null, label: string) => (url ? <a className="underline" href={url} target="_blank" rel="noreferrer">{label}</a> : null);

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2 text-xs">
        {[...LIFECYCLE, ...(r.status === "FAILED" ? ["FAILED"] : [])].map((s) => (
          <li key={s} className={s === r.status ? "font-semibold" : "text-muted-foreground"}>
            {s === r.status ? <StatusBadge status={s} /> : s.replace("_", " ")}
          </li>
        ))}
      </ol>
      <DetailPanel
        title={r.toolName}
        actions={<StatusBadge status={r.riskTier} />}
        fields={[
          { label: "Status", value: <StatusBadge status={r.status} /> },
          { label: "Team", value: r.team },
          { label: "Requested by", value: r.requestedById === session.userId ? "you" : r.requestedById },
          { label: "Estimated ACUs", value: r.estimatedAcus },
          { label: "Team budget this month", value: `${r.budget.used} / ${r.budget.limit} ACUs` },
          { label: "ACUs used", value: r.acusUsed ?? null },
          { label: "Devin session", value: link(r.devinSessionUrl, r.devinSessionId ?? "session") },
          { label: "Pull request", value: link(r.prUrl, r.prUrl ?? "") },
          { label: "Error", value: r.lastError },
        ]}
      />
      <RequestActions
        id={r.id}
        status={r.status}
        canSubmit={r.requestedById === session.userId}
        canApprove={hasPermission(session, "tools:approve") && r.requestedById !== session.userId}
      />
      {r.status === "SUBMITTED" && hasPermission(session, "tools:approve") && r.requestedById === session.userId ? (
        <p className="text-sm text-muted-foreground">You requested this tool, so another admin must approve it.</p>
      ) : null}
      {parsed.ok ? <p className="text-sm">{summarizeManifest(parsed.manifest)}</p> : null}
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{r.manifestYaml}</pre>
    </div>
  );
}
