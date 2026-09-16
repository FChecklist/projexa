import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { db, memberships } from "@/lib/db";
import { sendDigestForMembership } from "@/lib/email/digest";

// Manual trigger for the digest, standing in for the cadence engine the
// work order deliberately defers (see digest.ts's own header). Sends the
// caller's OWN digest -- proves the vertical slice on demand without a
// cron this repo doesn't have yet. Not the mandatory "there is no off"
// cadence; a real scheduled trigger is separate follow-up work.
export async function POST() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  if (!ctx.user || !ctx.organizationId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, ctx.user.id), eq(memberships.organizationId, ctx.organizationId)))
    .limit(1);

  if (!membership) return NextResponse.json({ error: "No membership found" }, { status: 404 });

  const result = await sendDigestForMembership(membership.id);
  return NextResponse.json(result);
}
