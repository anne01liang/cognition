// FIXTURE: a route handler with no requirePermission() call.
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ secrets: true });
}
