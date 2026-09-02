import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { MODULE_TAGS } from "@/lib/module-list-source";
import { revalidateTag } from "next/cache";

// Wave 143 (Minutes of Meeting module): proxies VERIDIAN's
// /api/v1/projexa/veri-meetings -- the real VERI Meeting Intelligence
// engine (live minutes, AI summary/action items, publish/lock), not
// PROJEXA's existing basic /api/meetings scheduling CRUD.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  try {
    const data = await callVeridian(`/veri-meetings${params}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load meetings");
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const body = await request.json();
    const data = await callVeridian("/veri-meetings", { method: "POST", body, organizationId: ctx.organizationId! });
    // R67 F-18: the module list is cached for 30 s on the server, so a
    // create must clear it or the new row is invisible until the window
    // expires -- which reads exactly like a failed save.
    revalidateTag(MODULE_TAGS.moms, "max");
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create meeting");
  }
}
