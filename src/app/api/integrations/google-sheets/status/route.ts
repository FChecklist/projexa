import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { db, googleSheetsIntegration } from "@/lib/db";
import { eq } from "drizzle-orm";
import { withTiming } from "@/lib/with-timing";

export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const row = await db.query.googleSheetsIntegration.findFirst({ where: eq(googleSheetsIntegration.organizationId, ctx.organizationId!) });
  if (!row) return NextResponse.json({ connected: false });

  return NextResponse.json({
    connected: true,
    spreadsheetUrl: row.spreadsheetUrl,
    status: row.status,
    lastError: row.lastError,
    lastPushedAt: row.lastPushedAt,
    lastPulledAt: row.lastPulledAt,
  });
});
