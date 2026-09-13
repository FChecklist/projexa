import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R85 Addendum 3 v4 (R-50), Phase 2/6 (E4 "cost visibility -- PM-configured,
// hard floor"). Proxies compliance-tracker's /construction/cost-visibility
// (GET/PATCH) -- the config surface BoqDualViewGrid.tsx's own INTERNAL view
// depends on: an internal role with no grant sees the SAME redacted shape
// the customer preview does (canRoleSeeCost()'s fail-closed default).
//
// ★ E4's HARD FLOOR, MIRRORED HERE, NOT JUST TRUSTED UPSTREAM ★
// "client_viewer can never be granted cost visibility. Not by the PM. Not
// by any setting or API. THE CONFIG UI MUST NOT EVEN OFFER IT." Upstream
// already enforces this at THREE independent layers (a DB CHECK constraint,
// CONFIGURABLE_ROLES excluding it from the GET response, and
// setCostVisibilityForRole()'s own 400 refusal) -- this route adds a FOURTH,
// on this side of the proxy: a PROJEXA caller that somehow sent
// role: "client_viewer" is refused HERE too, before the request even
// reaches VERIDIAN, so this specific prohibition is never dependent on the
// upstream call succeeding to hold.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian(`/construction/cost-visibility`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load cost visibility config");
  }
});

export const PATCH = withTiming("PATCH", async function PATCH(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  if (body?.role === "client_viewer" && body?.canSeeCost === true) {
    return NextResponse.json(
      { error: "client_viewer can never be granted cost visibility -- this is a hard floor, not a configurable option (D91 B1)." },
      { status: 400 }
    );
  }
  try {
    const data = await callVeridian(`/construction/cost-visibility`, {
      organizationId: ctx.organizationId!,
      root: true,
      method: "PATCH",
      body,
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update cost visibility config");
  }
});
