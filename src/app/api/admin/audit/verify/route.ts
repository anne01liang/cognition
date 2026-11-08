import { NextResponse } from "next/server";
import { getAppSession } from "@/platform/session";
import { requirePermission } from "@/platform/guard";
import { ActionError } from "@/platform/errors";
import { verifyAuditChain } from "@/platform/audit";
import { db } from "@/platform/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requirePermission(await getAppSession(), "audit:verify");
  } catch (err) {
    if (err instanceof ActionError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    throw err;
  }
  return NextResponse.json(await verifyAuditChain(db));
}
