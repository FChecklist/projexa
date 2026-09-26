import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// PROJEXA-BUILD-002 WP-10: thin proxy of VERIDIAN's /projects/{id}/approvals (compliance-tracker
// src/app/api/v1/projexa/projects/[id]/approvals/route.ts), the AI-prepared approval list of one project.
//
// GET answers the pending proposals an AI or an email prepared for the project, each with what would be written, what is still missing,
// and the one approve action. Nothing is written and no model is asked.
// POST is the approve action: {submissionId, params?}. It confirms the proposal from the parameters stored with it, merged with the
// `params` the person adds for the required values still missing (an answer of 200 {approved:false, status:"needs_input", missing} asks
// for them). It writes the BOQ line items under the acting person, so the write policy of this app is PM_OR_ABOVE, like /scope/[id]/approve.
// Refusals keep the upstream sentence; the upstream `status` of a 409 travels as `upstreamStatus`.
const SUBMISSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

function upstreamExtras(err: unknown): Record<string, unknown> {
  if (!(err instanceof VeridianApiError)) return {};
  const body = err.body as { status?: unknown } | undefined;
  return typeof body?.status === "string" ? { upstreamStatus: body.status } : {};
}

export const GET = withTiming("GET", async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/projects/${encodeURIComponent(id)}/approvals`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the proposals of this project");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  const submissionId = typeof body?.submissionId === "string" ? body.submissionId.trim() : "";
  if (!body || !SUBMISSION_ID.test(submissionId)) return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
  const added = body.params ?? {};
  if (typeof added !== "object" || added === null || Array.isArray(added)) return NextResponse.json({ error: "params must be an object." }, { status: 400 });
  try {
    // Only these two fields are relayed: nothing else in the browser's body reaches VERIDIAN.
    const data = await callVeridian<{ approved?: boolean }>(`/projects/${encodeURIComponent(id)}/approvals`, {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { submissionId, params: added },
    });
    // 201 when the proposal was written; 200 when the answer is a question (needs_input), which wrote nothing.
    return NextResponse.json(data, { status: data && data.approved === true ? 201 : 200 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to approve the proposal", undefined, upstreamExtras(err));
  }
});
