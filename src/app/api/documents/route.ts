import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, callVeridianUpload } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { MODULE_TAGS } from "@/lib/module-list-source";
import { revalidateTag } from "next/cache";

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
    return veridianErrorResponse(err, "Failed to load documents");
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const data = await callVeridianUpload("/documents", formData, { organizationId: ctx.organizationId!, root: true });
    // R67 F-18: the module list is cached for 30 s on the server, so a
    // create must clear it or the new row is invisible until the window
    // expires -- which reads exactly like a failed save.
    revalidateTag(MODULE_TAGS.documents, "max");
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to upload document");
  }
}
