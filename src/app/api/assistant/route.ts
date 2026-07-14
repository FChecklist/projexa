import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Dispatches through VERIDIAN's /api/v1/projexa/assistant (Wave 129) and
// keeps a local history row -- dispatchTool() is synchronous, so this table
// stands in for VERIDIAN's real async Tasks system (see drizzle/0002).
//
// Priority 17 (VERIDIAN platform provisioning): passes organizationId so
// callVeridian() resolves this org's own VERIDIAN API key from
// veridian_credentials instead of the shared demo VERIDIAN_API_KEY. Orgs
// with no credentials row yet (pre-existing/demo orgs) still fall back to
// the shared key automatically -- see resolveApiKey() in veridian-client.ts.
export async function GET() {
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
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await request.json();
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
    const message = err instanceof VeridianApiError ? err.message : "Failed to dispatch to VERIDIAN";
    await supabase.from("assistant_queries").update({ status: "error", error_message: message }).eq("id", row.id);
    return NextResponse.json({ error: message }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
