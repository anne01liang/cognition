import { defineApp } from "@/platform/app-manifest";
import { REFUND } from "./permissions";

export const refundsApp = defineApp({
  id: "refunds",
  name: "Refunds",
  description: "Request and approve customer refunds (four-eyes).",
  basePath: "/apps/refunds",
  permission: REFUND.read,
  nav: [
    { label: "Refunds", href: "/apps/refunds", permission: REFUND.read },
    { label: "Request refund", href: "/apps/refunds/new", permission: REFUND.request },
  ],
  pii: {
    Refund: {
      customerName: {
        readPermission: REFUND.read,
        load: async (tx, id) => (await tx.refund.findUnique({ where: { id }, select: { customerName: true } }))?.customerName ?? null,
      },
      accountNumber: {
        readPermission: REFUND.read,
        load: async (tx, id) => (await tx.refund.findUnique({ where: { id }, select: { accountNumber: true } }))?.accountNumber ?? null,
      },
    },
  },
});
