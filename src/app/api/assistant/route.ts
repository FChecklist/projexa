import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Dispatches through VERIDIAN's /api/v1/projexa/assistant (Wave 129) and
// keeps a local history row -- dispatchTool() is synchronous, so this table
// stands in for VERIDIAN's real async Tasks system (see drizzle/0002).
//
// Priority 17 (VERIDIAN platform provisioning): passes organizationId so
// callVeridian() resolves this org's own VERIDIAN API key from
// veridian_credentials instead of the shared demo VERIDIAN_API_KEY. Orgs
// with no credentials row yet (pre-existing/demo orgs) still fall back to
// the shared key automatically -- see resolveApiKey() in veridian-client.ts.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assistant_queries")
    .select("*")
    .eq("organization_id", ctx.organizationId!)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ queries: data });
});

// R42 seq14 (M25 pipeline): the real submission -> segmentation -> task
// pipeline, additive alongside the existing codeReference dispatch below
// (never a replacement -- see VERIDIAN's own route.ts header for why a full
// replacement here would have regressed R-80/R-82/R-90). No local
// assistant_queries row for this path: that table was always a stand-in for
// VERIDIAN's real async Tasks system (this file's own header comment,
// unchanged above); now that compliance.pipeline_tasks is that real system,
// this path talks to it directly and has nothing local left to shim.
async function postPipeline(ctx: Awaited<ReturnType<typeof requireAuth>>, body: Record<string, unknown>) {
  try {
    const data = await callVeridian("/assistant", {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { rawInput: body.rawInput, mode: body.mode, projectId: body.projectId, selectedChain: body.selectedChain },
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to run submission pipeline");
  }
}

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await request.json();

  if (typeof body.rawInput === "string") return postPipeline(ctx, body);

  const codeReference = String(body.codeReference ?? "");
  const breadcrumb = String(body.breadcrumb ?? codeReference);
  const inputs = body.inputs ?? {};
  if (!codeReference) return NextResponse.json({ error: "codeReference is required" }, { status: 400 });

  const supabase = await createClient();
  const { data: row, error: insertError } = await supabase
    .from("assistant_queries")
    .insert({
      organization_id: ctx.organizationId!,
      created_by: ctx.user!.id,
      code_reference: codeReference,
      breadcrumb,
      inputs,
      status: "pending",
    })
    .select()
    .single();
  if (insertError || !row) return NextResponse.json({ error: insertError?.message ?? "Failed to record query" }, { status: 500 });

  try {
    const result = await callVeridian<{ codeReference: string; result: unknown }>("/assistant", {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { codeReference, inputs },
    });
    const { data: updated } = await supabase
      .from("assistant_queries")
      .update({ status: "done", result: result.result })
      .eq("id", row.id)
      .select()
      .single();
    return NextResponse.json(updated ?? row, { status: 201 });
  } catch (err) {
    // R67 F-20: the row still records the backend's own words, and the
    // response is built by the shared classifier so this route reports the
    // same typed code / Retry-After as every other proxy.
    const message = err instanceof VeridianApiError ? err.message : "Failed to dispatch to VERIDIAN";
    await supabase.from("assistant_queries").update({ status: "error", error_message: message }).eq("id", row.id);
    return veridianErrorResponse(err, "Failed to dispatch to VERIDIAN");
  }
});
