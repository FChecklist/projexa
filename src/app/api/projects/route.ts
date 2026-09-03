import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { revalidateTag } from "next/cache";
import { withTiming } from "@/lib/with-timing";

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
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ projects: Record<string, unknown>[] }>("/dashboard", { organizationId: ctx.organizationId! });
    return NextResponse.json({ projects: data.projects ?? [] });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load projects");
  }
});

// Backs /projects/new (ProjectCreateClient.tsx, which replaced
// CreateProjectDialog in R67 D-01) -- the one entity in PROJEXA's full CRUD
// surface that previously had no create path at all (2026-07-18
// production-readiness pass).
export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    // R67 F-18: the cached list must be cleared or the new row is
    // invisible until the 30 s window expires, which reads as a failed save.
    revalidateTag("projects", "max");
    const data = await callVeridian("/projects", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create project");
  }
});
