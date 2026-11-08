import { defineApp } from "@/platform/app-manifest";
import { KYC } from "./permissions";

export const kycApp = defineApp({
  id: "kyc",
  name: "KYC Review",
  description: "Review customer identity cases with four-eyes approval.",
  basePath: "/apps/kyc",
  permission: KYC.read,
  nav: [
    { label: "Cases", href: "/apps/kyc", permission: KYC.read },
    { label: "New case", href: "/apps/kyc/new", permission: KYC.create },
  ],
  pii: {
    KycCase: {
      customerName: {
        readPermission: KYC.read,
        load: async (tx, id) => (await tx.kycCase.findUnique({ where: { id }, select: { customerName: true } }))?.customerName ?? null,
      },
      documentNumber: {
        readPermission: KYC.read,
        load: async (tx, id) => (await tx.kycCase.findUnique({ where: { id }, select: { documentNumber: true } }))?.documentNumber ?? null,
      },
    },
  },
});
