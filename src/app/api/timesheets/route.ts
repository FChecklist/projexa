import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Priority 17 Wave 1: proxies to VERIDIAN /api/v1/projexa/timesheets
// (listTimeEntriesForProject/ForIssue via pms-time-service.ts, plus
// logTime()). Supports ?projectId=, ?issueId=, ?spentOn= (the Design Studio
// day grid is a DAY, D-07) and ?mine=true (own timesheet only).
//
// R67 WS-H (D-05): every call forwards the logged-in PROJEXA user as the
// X-Acting-User header, so VERIDIAN attributes the entry to a named designer
// instead of to this org's shared API key. `mine=true` only means anything
// once it does -- before the bridge, VERIDIAN had no way to know who "me"
// was for a key-authenticated caller and answered with an empty list.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  const issueId = request.nextUrl.searchParams.get("issueId");
  const mine = request.nextUrl.searchParams.get("mine");
  const spentOn = request.nextUrl.searchParams.get("spentOn");
  if (!projectId && !issueId) return NextResponse.json({ error: "projectId or issueId query param is required" }, { status: 400 });
  const qs = new URLSearchParams();
  if (projectId) qs.set("projectId", projectId);
  if (issueId) qs.set("issueId", issueId);
  if (mine) qs.set("mine", mine);
  if (spentOn) qs.set("spentOn", spentOn);
  try {
    // FIX PASS: the acting user's email rides the X-Acting-User-Email HEADER,
    // never `?actorEmail=`. It was a query parameter in the first cut so this
    // GET could identify its caller, which contradicted the reason the id is a
    // header at all -- a query string is written to access logs and rides the
    // Referer header off-site, and an email is more identifying, not less.
    const data = await callVeridian(`/timesheets?${qs.toString()}`, {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load time entries");
  }
});

// R39/R-C12 fix-2: forward actorEmail so VERIDIAN can resolve a real acting
// user (this route was equally dead-on-arrival before that fix -- see
// timesheets/[id]/submit/route.ts's header comment for the full evidence
// trail; same root cause, predates R39).
export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  if (!body.issueId || !body.hours || !body.spentOn) {
    return NextResponse.json({ error: "issueId, hours, and spentOn are required" }, { status: 400 });
  }
  try {
    const data = await callVeridian("/timesheets", {
      organizationId: ctx.organizationId!,
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
      method: "POST",
      body,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to log time entry");
  }
});
