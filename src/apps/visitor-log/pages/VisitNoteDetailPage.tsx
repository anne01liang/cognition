import { notFound } from "next/navigation";
import { requirePagePermission } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { DetailPanel } from "@/components/platform/DetailPanel";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { getVisitNote } from "../actions";
import { VISITOR_LOG } from "../permissions";
import { SubmitVisitNoteButton } from "../components/SubmitVisitNoteButton";

export default async function VisitNoteDetailPage({ params }: { params: { id: string } }) {
  const session = await requirePagePermission(VISITOR_LOG.read);
  const res = await getVisitNote({ id: params.id });
  if (!res.ok) notFound();
  const n = res.data;

  return (
    <DetailPanel
      title={<span className="flex items-center gap-3">Visit note <StatusBadge status={n.status} /></span>}
      actions={hasPermission(session, VISITOR_LOG.write) && n.status === "DRAFT" ? <SubmitVisitNoteButton id={n.id} /> : null}
      fields={[
        { label: "Room", value: n.roomLabel },
        { label: "Note", value: n.note },
        { label: "Created", value: n.createdAt.toISOString().slice(0, 16).replace("T", " ") },
        { label: "Note id", value: <code className="text-xs">{n.id}</code> },
      ]}
    />
  );
}
