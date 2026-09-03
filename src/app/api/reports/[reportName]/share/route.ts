import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 E-12 (R-136): a real, tokenised, expiring share link for a report that
// has a public renderer -- the half item E-09 could not ship.
//
// E-09's Share copied the in-app /reports URL deliberately: VERIDIAN's share
// service accepted only "work_progress", so minting a token for any other
// report would have produced a PUBLIC link that 404s for whoever received it.
// E-12 adds project_status to that service AND the public page that renders it
// (src/app/share/report/[token]/page.tsx), so this route can exist.
//
// SHAREABLE is therefore not a convenience list: a slug reaches it only when
// the public page can really render that report. Anything else is refused here,
// in words, rather than handed out as a dead link.
const SHAREABLE: Record<string, string> = {
  "work-progress": "work_progress",
  "project-status": "project_status",
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ reportName: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { reportName } = await params;
  const reportType = SHAREABLE[reportName];
  if (!reportType) {
    return NextResponse.json(
      { error: `${reportName} has no public view yet, so it cannot be shared. Shareable reports: ${Object.keys(SHAREABLE).join(", ")}` },
      { status: 400 }
    );
  }

  let body: { projectId?: string; from?: string; to?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const { projectId, from, to } = body;
  if (!projectId || !from || !to) {
    return NextResponse.json({ error: "projectId, from and to are required" }, { status: 400 });
  }

  try {
    const data = await callVeridian<{ token: string; expiresAt: string }>("/reports/share", {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { reportType, reportRef: { projectId, from, to } },
    });
    // The public view lives on PROJEXA's own domain, not VERIDIAN's, so the URL
    // is built here -- the same rule the Work Progress Report's share route uses.
    const url = `${request.nextUrl.origin}/share/report/${data.token}`;
    return NextResponse.json({ url, expiresAt: data.expiresAt }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to create share link" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
