import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { revalidateTag } from "next/cache";
import { withTiming } from "@/lib/with-timing";

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
//
// R67 MERGE (D-11, lane D1 x lane F1, 2026-09-03). D-69 had widened this SAME
// route the other way: it passed VERIDIAN's rows through WHOLE, because the new
// /projects landing needs each project's money and task counts and this route
// was throwing them away. Both lanes were right about their own caller and the
// two cannot be reconciled in one endpoint -- a dropdown refetched on every
// navigation must not pay for an earned-value aggregate, and a list of project
// figures cannot be served from {id, name, status}.
//
// So they are two endpoints now, and F-03 keeps this one. The rich read moved
// to ./overview/route.ts, which is what ProjectsListClient reads; the switcher
// and every create screen's background project resolve keep this cheap one.
// Nothing was dropped -- see that file's header.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ projects: { id: string; name: string; status?: string }[] }>("/projects", { organizationId: ctx.organizationId! });
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
