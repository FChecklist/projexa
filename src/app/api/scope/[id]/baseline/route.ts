import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Sumeet R-100 (profit and loss for the project): Project 360's answer is computed from the FIRST confirmed baseline of the project's governing BOQ,
// and nothing could create one -- every project read "Not yet baselined" for ever. This is the proxy for the explicit "confirm the baseline" action
// (compliance-tracker POST /api/v1/projexa/scope/{id}/baseline: manager+, an evidence reference is required, the answer is metadata only).
// The role gate is PM_OR_ABOVE here (api-write-policy.ts) and manager+ on the backend; a refusal's real message reaches the screen verbatim.
export const GET = withTiming("GET", async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}/baseline`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the baselines");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { evidenceArtefactRef?: unknown };
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}/baseline`, {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { evidenceArtefactRef: typeof body.evidenceArtefactRef === "string" ? body.evidenceArtefactRef : "" },
      actingUserId: ctx.user?.id,
      actingUserEmail: ctx.user?.email ?? undefined,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to confirm the baseline");
  }
});
