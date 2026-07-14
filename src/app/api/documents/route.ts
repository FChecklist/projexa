import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Read-only by design, matching the Priority 2 exclusion (no drawing/image
// creation, viewer, or rendering here -- metadata/listing only) and
// VERIDIAN's own v1 contract: /api/v1/documents is GET-only today (upload
// stays internal-only, see that route's own code comment). Also lives at
// /api/v1/documents, not /api/v1/projexa/documents, so this uses the
// `root` override same as labour-roster.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { searchParams } = request.nextUrl;
  const linkedEntityId = searchParams.get("linkedEntityId");
  if (!linkedEntityId) return NextResponse.json({ error: "linkedEntityId query param is required" }, { status: 400 });

  const params = new URLSearchParams({ linkedEntityType: searchParams.get("linkedEntityType") ?? "project", linkedEntityId });
  const category = searchParams.get("category");
  if (category) params.set("category", category);

  try {
    const data = await callVeridian(`/documents?${params.toString()}`, { root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load documents" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
