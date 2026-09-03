import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 lane D22 (item D-64, rec R-230): the searchable BOQ line lookup behind
// the Daily Entry picker and every "which line is this?" question in this app.
//
// A thin relay -- VERIDIAN owns the BOQ, computes the quantity already
// recorded against each line, and decides which revision "the current BOQ"
// means. Reproducing any of that here would be a second answer to the same
// question, which is exactly the drift item D-64 exists to end.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const params = request.nextUrl.searchParams;
  const projectId = params.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });

  const forwarded = new URLSearchParams({ projectId });
  for (const key of ["q", "boqId", "limit"]) {
    const value = params.get(key);
    if (value) forwarded.set(key, value);
  }

  try {
    const data = await callVeridian(`/scope/lines?${forwarded.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Couldn't load BOQ lines" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
