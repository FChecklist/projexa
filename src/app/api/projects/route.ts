import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Feeds the ProjectSwitcher dropdown in AppSidebar with the org's real
// project list (id/name only -- the VERIDIAN API key itself never leaves
// veridian-client.ts / the server).
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ projects: { id: string; name: string }[] }>("/dashboard", { organizationId: ctx.organizationId! });
    return NextResponse.json({ projects: data.projects ?? [] });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load projects");
  }
}

// Backs CreateProjectDialog -- the one entity in PROJEXA's full CRUD
// surface that previously had no create path at all (2026-07-18
// production-readiness pass).
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/projects", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create project");
  }
}
