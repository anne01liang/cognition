/** 30 realistic, entirely fake onboarding applications for the kyc-review app (dev seed only). */
import { slaDueFrom } from "../src/apps/kyc-review/rules";

const HOUR = 60 * 60 * 1000;

// [name, country, dateOfBirth, riskScore, hours since the customer submitted]
const PEOPLE: [string, string, string, number, number][] = [
  ["Emily Carter", "US", "1988-04-12", 12, 2],
  ["Marcus Johnson", "US", "1975-11-03", 85, 70],
  ["Priya Raman", "IN", "1992-07-21", 34, 5],
  ["Oliver Bennett", "GB", "1984-01-30", 67, 30],
  ["Sofia Martínez", "ES", "1990-09-14", 22, 50],
  ["Lukas Schneider", "DE", "1979-05-08", 91, 1],
  ["Chloé Dubois", "FR", "1995-12-02", 45, 96],
  ["Daniel Okafor", "NG", "1987-03-19", 73, 12],
  ["Ana Souza", "BR", "1993-06-25", 8, 60],
  ["Wei Ling Tan", "SG", "1981-10-11", 58, 20],
  ["Liam O'Connor", "IE", "1998-02-17", 30, 44],
  ["Fatima Al-Sayed", "AE", "1986-08-29", 88, 120],
  ["Diego Hernández", "MX", "1991-04-04", 64, 3],
  ["Hannah Kim", "CA", "1983-12-22", 15, 49],
  ["Jacob Miller", "US", "1970-07-07", 77, 26],
  ["Aisha Bello", "NG", "1996-01-15", 49, 80],
  ["Thomas van Dijk", "NL", "1989-11-28", 26, 10],
  ["Isabella Rossi", "IT", "1994-03-09", 71, 47],
  ["Noah Williams", "US", "2001-05-30", 95, 52],
  ["Meera Patel", "GB", "1985-09-09", 38, 15],
  ["Carlos Ruiz", "ES", "1977-03-03", 70, 6],
  ["Grace Thompson", "CA", "1994-10-19", 19, 100],
  ["Ahmed Hassan", "AE", "1982-06-06", 55, 36],
  ["Julia Becker", "DE", "1999-08-16", 82, 58],
  ["Ethan Brooks", "US", "1990-02-27", 5, 200],
  ["Lucía Fernández", "MX", "1987-12-12", 69, 150],
  ["Rohan Mehta", "IN", "1993-04-23", 29, 90],
  ["Sarah Nguyen", "US", "1980-01-08", 76, 170],
  ["Kwame Mensah", "GB", "1976-09-01", 52, 75],
  ["Mia de Vries", "NL", "1997-07-14", 99, 130],
];

type Rec = "APPROVE" | "REJECT" | "ESCALATE";
// Workflow state by index: 0-11 unassigned, 12-17 claimed by the analyst, 18-23 awaiting second review, 24-29 decided.
const PENDING: Record<number, [Rec, string]> = {
  18: ["REJECT", "Sanctions list partial match on name and DOB; recommend reject pending second review."],
  19: ["APPROVE", "Passport and proof of address consistent; no adverse media."],
  20: ["APPROVE", "High score driven by occupation (cash-intensive business); source of funds documented."],
  21: ["ESCALATE", "Address on utility bill does not match application; needs senior judgement."],
  22: ["APPROVE", "All documents verified against issuing authority database."],
  23: ["REJECT", "Selfie liveness check failed twice; document photo mismatch."],
};
const DECIDED: Record<number, { rec: Rec; recReason: string; status: "APPROVED" | "REJECTED"; byApprover: boolean; reason: string }> = {
  24: { rec: "REJECT", recReason: "Expired passport, customer unresponsive for 7 days.", status: "REJECTED", byApprover: false, reason: "Expired passport, customer unresponsive for 7 days." },
  25: { rec: "APPROVE", recReason: "Documents verified.", status: "APPROVED", byApprover: true, reason: "Concur with analyst; documents verified." },
  26: { rec: "APPROVE", recReason: "Low-risk retail customer, clean checks.", status: "APPROVED", byApprover: true, reason: "Approved." },
  27: { rec: "REJECT", recReason: "PEP match confirmed, undisclosed.", status: "REJECTED", byApprover: true, reason: "Undisclosed PEP status; reject per policy 4.2." },
  28: { rec: "APPROVE", recReason: "Bank statement confirms income.", status: "APPROVED", byApprover: true, reason: "Approved after reviewing bank statement." },
  29: { rec: "ESCALATE", recReason: "Multiple high-risk jurisdictions in transaction history.", status: "REJECTED", byApprover: true, reason: "Risk appetite exceeded; reject." },
};

export function kycReviewSeedCases(users: { analyst: string; approver: string }, now = new Date()) {
  return PEOPLE.map(([customerName, country, dob, riskScore, hoursAgo], i) => {
    const submittedAt = new Date(now.getTime() - hoursAgo * HOUR);
    const slug = customerName.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-");
    const at = (h: number) => new Date(submittedAt.getTime() - h * HOUR).toISOString();
    const documents = [
      { type: country === "US" ? "DRIVERS_LICENSE" : "PASSPORT", url: `https://docs.example.internal/kyc/${slug}/id.pdf`, uploadedAt: at(2) },
      { type: "PROOF_OF_ADDRESS", url: `https://docs.example.internal/kyc/${slug}/address.pdf`, uploadedAt: at(1.5) },
      { type: "SELFIE", url: `https://docs.example.internal/kyc/${slug}/selfie.jpg`, uploadedAt: at(1) },
      ...(riskScore >= 70 ? [{ type: "BANK_STATEMENT", url: `https://docs.example.internal/kyc/${slug}/bank.pdf`, uploadedAt: at(0.5) }] : []),
    ];
    const base = {
      customerName,
      dateOfBirth: new Date(`${dob}T00:00:00Z`),
      // 9xx area numbers are never issued as SSNs.
      ssn: `9${String(10 + i).padStart(2, "0")}-${String(41 + i * 2).slice(-2)}-${String(1000 + i * 137).slice(-4)}`,
      country,
      riskScore,
      documents,
      submittedAt,
      slaDueAt: slaDueFrom(submittedAt),
    };
    if (i >= 12 && i <= 17) return { ...base, assignedTo: users.analyst };
    const pending = PENDING[i];
    if (pending) {
      const [recommendation, recommendationReason] = pending;
      return { ...base, status: "PENDING" as const, assignedTo: users.analyst, submittedById: users.analyst, recommendation, recommendationReason };
    }
    const d = DECIDED[i];
    if (d) {
      return {
        ...base,
        status: d.status,
        assignedTo: users.analyst,
        submittedById: users.analyst,
        decidedById: d.byApprover ? users.approver : users.analyst,
        recommendation: d.rec,
        recommendationReason: d.recReason,
        decisionReason: d.reason,
      };
    }
    return base;
  });
}
