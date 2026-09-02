import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { MODULE_TAGS } from "@/lib/module-list-source";
import { revalidateTag } from "next/cache";

// Point 33: the material master (name/spec/unit/unitCost). Lives at VERIDIAN's
// /api/v1/construction/materials -- root:true because it was never
// re-exported under /api/v1/projexa/*, same reasoning as labour-roster.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/construction/materials?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load material master");
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/construction/materials", { organizationId: ctx.organizationId!, method: "POST", body, root: true });
    // R67 F-18: the module list is cached for 30 s on the server, so a
    // create must clear it or the new row is invisible until the window
    // expires -- which reads exactly like a failed save.
    revalidateTag(MODULE_TAGS.materials, "max");
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create material");
  }
}
