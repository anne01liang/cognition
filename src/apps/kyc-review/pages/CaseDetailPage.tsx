import { notFound } from "next/navigation";
import { requirePagePermission } from "@/platform/session";
import { hasPermission } from "@/platform/guard";
import { DetailPanel } from "@/components/platform/DetailPanel";
import { StatusBadge } from "@/components/platform/StatusBadge";
import { MaskedField } from "@/components/platform/MaskedField";
import { Badge } from "@/components/ui/badge";
import { getCase } from "../actions";
import { KYC_REVIEW } from "../permissions";
import { HIGH_RISK_THRESHOLD, formatUtc, riskBand } from "../rules";
import { ReviewActions } from "../components/ReviewActions";

export default async function CaseDetailPage({ params }: { params: { id: string } }) {
  const session = await requirePagePermission(KYC_REVIEW.queue);
  const res = await getCase({ id: params.id });
  if (!res.ok) notFound();
  const c = res.data;
  const mine = c.assignedTo === session.userId;
  const who = (userId: string | null) => (userId === null ? null : userId === session.userId ? "Me" : "Another user");

  return (
    <div className="space-y-4">
      <DetailPanel
        title={
          <span className="flex items-center gap-3">
            KYC application <StatusBadge status={c.status} />
            {c.slaBreached ? <Badge variant="destructive">SLA breached</Badge> : null}
          </span>
        }
        fields={[
          { label: "Customer", value: <MaskedField value={c.customerName} entityType="KycReviewCase" entityId={c.id} field="customerName" /> },
          { label: "Date of birth", value: <MaskedField value={c.dateOfBirth} entityType="KycReviewCase" entityId={c.id} field="dateOfBirth" /> },
          { label: "SSN", value: <MaskedField value={c.ssn} entityType="KycReviewCase" entityId={c.id} field="ssn" /> },
          { label: "Country", value: c.country },
          {
            label: "Risk score",
            value: (
              <span className="inline-flex items-center gap-2">
                {c.riskScore} <StatusBadge status={riskBand(c.riskScore)} />
              </span>
            ),
          },
          { label: "Assigned to", value: who(c.assignedTo) ?? "Unassigned" },
          { label: "Submitted", value: formatUtc(c.submittedAt) },
          { label: "SLA due", value: <span className={c.slaBreached ? "font-medium text-red-700" : ""}>{formatUtc(c.slaDueAt)}</span> },
          { label: "Recommendation", value: c.recommendation ? `${c.recommendation} (${who(c.submittedById)}): ${c.recommendationReason}` : null },
          { label: "Decision", value: c.decidedById ? `${who(c.decidedById)}: ${c.decisionReason}` : null },
          { label: "Case id", value: <code className="text-xs">{c.id}</code> },
        ]}
      />
      <DetailPanel
        title="Documents"
        fields={
          c.documents.length === 0
            ? [{ label: "None", value: "No documents uploaded." }]
            : c.documents.map((d, i) => ({
                label: `${i + 1}. ${d.type.replaceAll("_", " ")}`,
                value: (
                  <span>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">
                      Open document
                    </a>{" "}
                    <span className="text-muted-foreground">uploaded {formatUtc(new Date(d.uploadedAt))}</span>
                  </span>
                ),
              }))
        }
      />
      <ReviewActions
        id={c.id}
        canClaim={hasPermission(session, KYC_REVIEW.review) && c.status === "DRAFT" && c.assignedTo === null}
        canRecommend={hasPermission(session, KYC_REVIEW.review) && c.status === "DRAFT" && mine}
        canFinalize={hasPermission(session, KYC_REVIEW.approve) && c.status === "PENDING" && c.submittedById !== session.userId}
        highRisk={c.riskScore >= HIGH_RISK_THRESHOLD}
      />
    </div>
  );
}
