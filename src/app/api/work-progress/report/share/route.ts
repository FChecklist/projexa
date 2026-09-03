import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Point 118: creates a tokenised, expiring, read-only share link for the
// Work Progress Report -- NOT the WhatsApp Business API (explicitly ruled
// out), just a plain URL the user pastes into WhatsApp themselves. Backed
// by VERIDIAN's v1/projexa/reports/share (authenticated, Bearer/session).
// The public VIEW of that link is a separate, unauthenticated page --
// src/app/share/report/[token]/page.tsx -- which this route builds the URL
// for, since it lives on PROJEXA's own domain, not VERIDIAN's.
export const POST = withTiming("POST", async function POST(request: NextRequest) {
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
      body: { reportType: "work_progress", reportRef: { projectId, from, to } },
    });
    const url = `${request.nextUrl.origin}/share/report/${data.token}`;
    return NextResponse.json({ url, expiresAt: data.expiresAt }, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create share link");
  }
});
