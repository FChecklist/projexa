import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Feeds the ProjectSwitcher dropdown with the org's real project list (id/
// name/status only -- the VERIDIAN API key itself never leaves
// veridian-client.ts / the server).
//
// R67 F-03: this used to call VERIDIAN's /dashboard -- getOrgDashboard(), the
// earned-value/BOQ/invoice aggregate measured at 1.4-4.0 s -- to fill a
// dropdown that shows a name. It now calls the cheap /projects endpoint,
// which compliance-tracker answers from one indexed read inside one
// transaction, with its own 60 s per-org cache. Same reason
// resolveSelectedProject() moved: the shell fetches this on every navigation.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ projects: { id: string; name: string; status?: string }[] }>("/projects", { organizationId: ctx.organizationId! });
    return NextResponse.json({ projects: data.projects ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load projects" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
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
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to create project" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
