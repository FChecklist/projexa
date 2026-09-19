import { NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { db, googleSheetsIntegration } from "@/lib/db";
import { eq } from "drizzle-orm";
import { withTiming } from "@/lib/with-timing";

// Clears this org's connection record only -- the actual Google Sheet file
// is left alone in the service account's Drive (reversible: reconnecting
// creates a fresh spreadsheet rather than trying to reclaim the old one,
// which keeps this action simple and safe to retry).
export const POST = withTiming("POST", async function POST() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (roleError) return roleError;

  await db.delete(googleSheetsIntegration).where(eq(googleSheetsIntegration.organizationId, ctx.organizationId!));
  return NextResponse.json({ disconnected: true });
});
