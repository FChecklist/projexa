import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, callVeridianUpload } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { MODULE_TAGS } from "@/lib/module-list-source";
import { revalidateTag } from "next/cache";
import { withTiming } from "@/lib/with-timing";

// Wave 143 (Drawings & 3D module): proxy to VERIDIAN's
// /api/v1/projexa/drawings -- DWG file uploads and 3D walkthrough
// files/links, per project.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  const forward = new URLSearchParams({ projectId });
  const kind = searchParams.get("kind");
  if (kind) forward.set("kind", kind);
  // R67 D-10: the register's Filter offers Kind AND Discipline; both are
  // applied upstream so the count the screen shows is the count the backend
  // actually returned, not a second client-side narrowing on top of it.
  const discipline = searchParams.get("discipline");
  if (discipline) forward.set("discipline", discipline);
  // R67 D-12. This line was MISSING, and the omission was silent: the screen
  // sends &status=current from first paint (DrawingsClient's DEFAULT_FILTERS)
  // and draws a removable "Current only" chip over the result, but this proxy
  // dropped the parameter, so VERIDIAN's matchesStatus never saw it and the
  // register listed superseded and for-approval revisions under a chip
  // claiming otherwise -- with "Showing n of m" reading n of n, because the
  // filtered query and the count query resolved identically. There is no
  // client-side fallback filter behind this: whatever this URL carries is what
  // the table shows. Asserted in route.test.ts.
  const status = searchParams.get("status");
  if (status) forward.set("status", status);
  try {
    const data = await callVeridian(`/drawings?${forward.toString()}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load drawings");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const data = await callVeridianUpload("/drawings", formData, { organizationId: ctx.organizationId! });
    // R67 F-18: the module list is cached for 30 s on the server, so a
    // create must clear it or the new row is invisible until the window
    // expires -- which reads exactly like a failed save.
    revalidateTag(MODULE_TAGS.drawings, "max");
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create drawing");
  }
});
