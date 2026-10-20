import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// The System log's list of grouped problems. Owner / admin only: it shows what went wrong for everybody in the organisation.
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (roleError) return roleError;
  const sp = request.nextUrl.searchParams;
  const params = new URLSearchParams();
  for (const k of ["status", "projectId"]) {
    const v = sp.get(k);
    if (v) {
      if (!SAFE.test(v)) return NextResponse.json({ error: `${k} is not valid` }, { status: 400 });
      params.set(k, v);
    }
  }
  const limit = Number(sp.get("limit"));
  if (Number.isInteger(limit) && limit > 0) params.set("limit", String(Math.min(limit, 200)));
  try {
    const qs = params.toString();
    const data = await callVeridian(`/client-logs/issues${qs ? `?${qs}` : ""}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the system log");
  }
});
