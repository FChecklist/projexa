import { NextRequest, NextResponse } from "next/server";
import { runDigestCadence } from "@/lib/email/digest";

// Cron-triggered entry point for PROJEXA's recurring digest cadence -- the
// no-manual-trigger counterpart to POST /api/email/send-digest. Vercel Cron
// (vercel.json's "crons" array) hits this on a schedule; same shared-secret
// pattern as compliance-tracker's /api/internal/*/run routes.
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDigestCadence();
    return NextResponse.json(result); // result already carries its own ranAt
  } catch (error) {
    console.error("Digest cadence run failed:", error);
    return NextResponse.json({ error: "Digest cadence run failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
