/** Business rules for kyc-review. Plain module (not "use server"): shared by actions, pages, seed and tests. */

export const RECOMMENDATIONS = ["APPROVE", "REJECT", "ESCALATE"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const HIGH_RISK_THRESHOLD = 70;
export const SLA_HOURS = 48;

/**
 * riskScore >= 70, or any APPROVE recommendation, needs a second person with
 * kyc:approve. ESCALATE hands the case to a second person by definition. Only a
 * low-risk REJECT is final on the analyst's word.
 */
export function requiresSecondPerson(riskScore: number, recommendation: Recommendation): boolean {
  return riskScore >= HIGH_RISK_THRESHOLD || recommendation !== "REJECT";
}

export function slaDueFrom(submittedAt: Date): Date {
  return new Date(submittedAt.getTime() + SLA_HOURS * 60 * 60 * 1000);
}

const OPEN_STATUSES = new Set(["DRAFT", "PENDING", "ESCALATED"]);

export function isSlaBreached(c: { status: string; slaDueAt: Date }, now: Date = new Date()): boolean {
  return OPEN_STATUSES.has(c.status) && c.slaDueAt.getTime() < now.getTime();
}

export function riskBand(score: number): "LOW" | "MEDIUM" | "HIGH" {
  return score >= HIGH_RISK_THRESHOLD ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const formatUtc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
