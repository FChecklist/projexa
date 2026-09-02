import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 lane D22 (item D-58, rec R-187): the org directory behind every people
// picker in this app.
//
// NOT the same list as /api/org-members. That route reads PROJEXA's own
// `memberships` table (Supabase auth users of this app) and is right for
// "who can log in here". This one reads VERIDIAN's compliance.users, whose
// ids are what an action item's owner FK actually points at -- which is why
// the MoM screen used to ask a human to paste one by hand. Org scope comes
// from the caller's own session/API key on the VERIDIAN side; nothing in the
// querystring can widen it.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const limit = request.nextUrl.searchParams.get("limit") ?? "";
  // R67 D-77: resolve ids a screen already holds (a task's assignees) into
  // names, so no screen prints a user id.
  const ids = request.nextUrl.searchParams.get("ids") ?? "";
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (limit) params.set("limit", limit);
  if (ids) params.set("ids", ids);
  const suffix = params.toString() ? `?${params.toString()}` : "";

  try {
    const data = await callVeridian(`/org-users${suffix}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Couldn't load the people list" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
