import { notFound } from "next/navigation";
import { requirePagePermission } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { DetailPanel } from "@/components/platform/DetailPanel";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { MaskedField } from "@/components/platform/MaskedField";
import { getRefund } from "../actions";
import { REFUND } from "../permissions";
import { formatMoney } from "../money";
import { RefundDecision } from "../components/RefundDecision";

export default async function RefundDetailPage({ params }: { params: { id: string } }) {
  const session = await requirePagePermission(REFUND.read);
  const res = await getRefund({ id: params.id });
  if (!res.ok) notFound();
  const r = res.data;
  const notSubmitter = r.submittedById !== session.userId;
  const canDecide =
    notSubmitter &&
    ((r.status === "PENDING" && hasPermission(session, REFUND.approve)) ||
      (r.status === "ESCALATED" && hasPermission(session, REFUND.approve) && hasPermission(session, REFUND.escalation)));
  return (
    <div className="space-y-4">
      <DetailPanel
        title={<span className="flex items-center gap-3">Refund <StatusBadge status={r.status} /></span>}
        fields={[
          { label: "Customer", value: r.customerName },
          { label: "Account number", value: <MaskedField value={r.accountNumber} entityType="Refund" entityId={r.id} field="accountNumber" /> },
          { label: "Amount", value: formatMoney(r.amountCents, r.currency) },
          { label: "Reason", value: r.reason },
          { label: "Decision reason", value: r.decisionReason },
        ]}
      />
      {canDecide ? <RefundDecision id={r.id} allowEscalate={r.status === "PENDING"} /> : null}
    </div>
  );
}
