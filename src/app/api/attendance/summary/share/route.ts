import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-31 (R-090): "Share" on the Manpower screen. It reuses the EXISTING
// signed-link mechanism -- the same report_share_links table, token, expiry and
// revocation rules the Work Progress Report share has used since point 118 --
// rather than growing a second one; VERIDIAN's report-share-service simply
// gained "attendance_summary" as a second shareable type. Like that one, this
// is NOT the WhatsApp Business API: it mints an unguessable URL the user pastes
// wherever they like. The public VIEW of that link lives on PROJEXA's own
// domain, so this route builds it.
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  const { projectId, from, to } = body;
  if (!projectId || !from || !to) {
    return NextResponse.json({ error: "projectId, from and to are required" }, { status: 400 });
  }
  try {
    const data = await callVeridian<{ token: string; expiresAt: string }>("/reports/share", {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { reportType: "attendance_summary", reportRef: { projectId, from, to } },
    });
    const url = `${request.nextUrl.origin}/share/attendance/${data.token}`;
    return NextResponse.json({ url, expiresAt: data.expiresAt }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to create share link" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
