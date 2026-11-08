import { notFound } from "next/navigation";
import { requirePagePermission } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { DetailPanel } from "@/components/platform/DetailPanel";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { MaskedField } from "@/components/platform/MaskedField";
import { getCase } from "../actions";
import { KYC } from "../permissions";
import { CaseActions } from "../components/CaseActions";

export default async function CaseDetailPage({ params }: { params: { id: string } }) {
  const session = await requirePagePermission(KYC.read);
  const res = await getCase({ id: params.id });
  if (!res.ok) notFound();
  const c = res.data;
  const isSubmitter = c.submittedById === session.userId;

  return (
    <div className="space-y-4">
      <DetailPanel
        title={<span className="flex items-center gap-3">KYC case <StatusBadge status={c.status} /></span>}
        fields={[
          { label: "Customer", value: <MaskedField value={c.customerName} entityType="KycCase" entityId={c.id} field="customerName" /> },
          { label: "Document number", value: <MaskedField value={c.documentNumber} entityType="KycCase" entityId={c.id} field="documentNumber" /> },
          { label: "Country", value: c.country },
          { label: "Risk", value: <StatusBadge status={c.riskLevel} /> },
          { label: "Notes", value: c.notes },
          { label: "Decision reason", value: c.decisionReason },
          { label: "Case id", value: <code className="text-xs">{c.id}</code> },
        ]}
      />
      <CaseActions
        id={c.id}
        status={c.status}
        canSubmit={hasPermission(session, KYC.review) && c.status === "DRAFT"}
        canDecide={hasPermission(session, KYC.approve) && c.status === "PENDING" && !isSubmitter}
        canResolve={hasPermission(session, KYC.escalation) && c.status === "ESCALATED" && !isSubmitter}
      />
    </div>
  );
}
