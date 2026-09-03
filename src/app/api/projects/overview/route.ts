import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 D-69 x F-03, reconciled by the integration train (D-11, 2026-09-03).
//
// Backs the /projects landing (ProjectsListClient.tsx). Its rows are the FULL
// per-project shape VERIDIAN's /dashboard already returns -- task counts, the
// D-62 money trio (contractValue / projectValue / projectValueSource),
// earnedValue and percentByValue -- which is exactly what the list renders.
//
// WHY THIS EXISTS AS A SECOND ROUTE. D-69 originally got these rows by making
// ../route.ts pass /dashboard through whole. Lane F1's F-03 then changed that
// same route to call the cheap /projects endpoint instead, because the app
// shell's ProjectSwitcher refetches it on EVERY navigation and was paying
// 1.4-4.0 s for the earned-value aggregate to fill a dropdown that shows a
// name. Both changes are correct for their own caller and contradict each
// other in one endpoint, so the two readers now have one endpoint each:
//
//   GET /api/projects           -> {id, name, status}, cheap, per-navigation
//   GET /api/projects/overview  -> the full rows, read once by the list screen
//
// The aggregate cost F-03 measured is not reintroduced anywhere: it is paid
// only on the one screen whose entire purpose is to display those figures.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ projects: Record<string, unknown>[] }>("/dashboard", {
      organizationId: ctx.organizationId!,
    });
    return NextResponse.json({ projects: data.projects ?? [] });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load projects");
  }
});
