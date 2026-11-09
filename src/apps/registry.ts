import type { AppManifest } from "@/platform/app-manifest";
import type { Permission } from "@/platform/rbac";
import { kycApp } from "./kyc/manifest";
import { kycReviewApp } from "./kyc-review/manifest";
import { refundsApp } from "./refunds/manifest";

/**
 * Every app MUST be listed here (enforced by src/apps/registry.test.ts).
 * Order = order in the left nav.
 */
export const APPS: readonly AppManifest[] = [kycApp, kycReviewApp, refundsApp];

export function visibleApps(permissions: ReadonlySet<Permission>) {
  return APPS.filter((app) => permissions.has(app.permission)).map((app) => ({
    ...app,
    nav: app.nav.filter((item) => permissions.has(item.permission)),
  }));
}

export function findPiiResolver(entityType: string, field: string) {
  for (const app of APPS) {
    const resolver = app.pii?.[entityType]?.[field];
    if (resolver) return resolver;
  }
  return undefined;
}
