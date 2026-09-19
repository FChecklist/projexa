import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

// Real-screen conversion (2026-08-30): the list never had a detail route --
// proxies to VERIDIAN's already-existing getChangeOrder() (GET was never
// exposed here before, only PATCH for submit-for-approval).
export const GET = withTiming("GET", async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/change-orders/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load change order");
  }
});

export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE);
  if (roleError) return roleError;
  const { id } = await params;
  const body = await request.json();
  try {
    // R-97 fix (2026-09-19, Owner-authorized): action:"submit" (send for
    // e-signature) needs a real acting user to attribute the request to --
    // forwarded the same way every other per-user-attributed call in this
    // file's own sibling routes already does (scope/[id]/route.ts,
    // timesheets/[id]/route.ts). Without these, VERIDIAN's own PATCH always
    // 400'd "requires a real user session, not an API key" for every
    // PROJEXA-proxied caller, since ctx.dbUser is unconditionally null for
    // the shared per-org API key this server calls VERIDIAN with.
    const data = await callVeridian(`/change-orders/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      method: "PATCH",
      body,
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update change order");
  }
});
