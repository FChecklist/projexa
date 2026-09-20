import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R42 seq24 (DASHBOARD.PROJECT): thin proxy to VERIDIAN's existing
// /api/v1/projexa/dashboard/[projectId] -- the getProjectDashboard() data
// layer already existed (Wave 121); this seq only added earnedValue/
// percentByValue/contractValue to it (D-3, reusing earnedValueReport). No
// projexa consumer of this endpoint existed before this seq.
//
// R-50 REOPENED FIX (platform.sumeet_requirements): this call used to omit
// actingUserId/actingUserEmail entirely. This repo authenticates every
// VERIDIAN call with a single shared per-org API key (see veridian-client.ts's
// own header), so without these VERIDIAN's cost/financial-visibility gate had
// no real internal role to check for -- it fell back to its own fail-closed
// default in the older code (leaving the redaction question moot) but the
// REAL, live bug this fixes lives entirely on VERIDIAN's own side (a
// `ctx.dbUser && ...` check that only ever evaluates for a session caller and
// therefore never redacts a PROJEXA-proxied request at all). Forwarding the
// real acting user here is what lets VERIDIAN's fixed gate tell client_viewer
// apart from a manager/CEO in the first place -- mirrors /api/scope/[id]/
// route.ts's existing actingUserId/actingUserEmail forwarding for the exact
// same reason (BoqDualViewGrid.tsx's cost-visibility gate).
export const GET = withTiming("GET", async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { projectId } = await params;
  try {
    const data = await callVeridian(`/dashboard/${encodeURIComponent(projectId)}`, {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load project dashboard");
  }
});
