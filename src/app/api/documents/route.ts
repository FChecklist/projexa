import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, callVeridianUpload, VeridianApiError } from "@/lib/veridian-client";

// Wave 143 (Documents real upload): VERIDIAN's /api/v1/documents gained a
// real POST (createDocumentRecord, Bearer-key-callable) -- this is no
// longer read-only. Also lives at /api/v1/documents, not
// /api/v1/projexa/documents, so this uses the `root` override same as
// labour-roster.
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
    const data = await callVeridian(`/documents?${params.toString()}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load documents" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const data = await callVeridianUpload("/documents", formData, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to upload document" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
