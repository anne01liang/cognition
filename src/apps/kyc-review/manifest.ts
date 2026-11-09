import { defineApp } from "@/platform/app-manifest";
import { KYC_REVIEW } from "./permissions";
import { isoDate } from "./rules";

export const kycReviewApp = defineApp({
  id: "kyc-review",
  name: "KYC Compliance Queue",
  description: "Claim onboarding applications, recommend a decision, and finalize with four-eyes approval.",
  basePath: "/apps/kyc-review",
  permission: KYC_REVIEW.queue,
  nav: [
    { label: "Review queue", href: "/apps/kyc-review?view=queue", permission: KYC_REVIEW.review },
    { label: "Awaiting approval", href: "/apps/kyc-review?view=approvals", permission: KYC_REVIEW.approve },
  ],
  pii: {
    KycReviewCase: {
      customerName: {
        readPermission: KYC_REVIEW.queue,
        load: async (tx, id) => (await tx.kycReviewCase.findUnique({ where: { id }, select: { customerName: true } }))?.customerName ?? null,
      },
      dateOfBirth: {
        readPermission: KYC_REVIEW.queue,
        load: async (tx, id) => {
          const row = await tx.kycReviewCase.findUnique({ where: { id }, select: { dateOfBirth: true } });
          return row ? isoDate(row.dateOfBirth) : null;
        },
      },
      ssn: {
        readPermission: KYC_REVIEW.queue,
        load: async (tx, id) => (await tx.kycReviewCase.findUnique({ where: { id }, select: { ssn: true } }))?.ssn ?? null,
      },
    },
  },
});
