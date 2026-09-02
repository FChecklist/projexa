import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Feeds the ProjectSwitcher dropdown in AppSidebar with the org's real
// project list (the VERIDIAN API key itself never leaves veridian-client.ts /
// the server).
//
// R67 D-69: the rows are passed through whole rather than reduced to id/name.
// VERIDIAN's /dashboard has always returned the per-project money and task
// counts -- this route was throwing them away, which is why /projects could not
// exist as a list without a second round trip for figures the first one already
// had. Every existing caller (the switcher, the create screens' background
// project resolve) reads id and name and is unaffected by the extra fields.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ projects: Record<string, unknown>[] }>("/dashboard", { organizationId: ctx.organizationId! });
    return NextResponse.json({ projects: data.projects ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load projects" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

// Backs /projects/new (ProjectCreateClient.tsx, which replaced
// CreateProjectDialog in R67 D-01) -- the one entity in PROJEXA's full CRUD
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
