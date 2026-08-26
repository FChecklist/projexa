import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  try {
    const data = await callVeridian(`/scope?projectId=${encodeURIComponent(projectId)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load scope of work" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

// R46M13_TC10_01 (fault reproduced live 3x on projexa-ai.com, 2026-08-25):
// creating a parent + 3-weighted-children BOQ through the real "New BOQ"
// dialog showed a green "BOQ created" toast while NOTHING was persisted.
// Server-verified against compliance.construction_boqs: none of the three
// attempts left a row at all -- not even an empty header -- so the upstream
// write rolled back entirely while the UI reported success.
//
// This handler was one of the two places that turned that non-write into a
// reported success: it forwarded whatever VERIDIAN returned straight back
// under a HARDCODED 201 Created, without ever looking at it. Any 2xx body
// was therefore reported as a created BOQ -- including a body carrying no
// BOQ at all, which is reachable in the upstream contract rather than
// hypothetical: VERIDIAN's getBoqRow() is `{ ...boq, lineItems }` over a
// findFirst() that can return undefined, and spreading undefined yields
// `{ lineItems: [] }` with no id.
//
// A create is now only reported as success when the response PROVES the
// write landed: a real row id, plus at least as many line items as were
// submitted. VERIDIAN builds that lineItems array from a fresh SELECT taken
// after the inserts, so checking it is a genuine read-back rather than an
// echo of the request. Anything short of that leaves here as a non-2xx with
// a message the dialog can show, so a failed write can never again surface
// as "BOQ created".
type CreatedBoqResponse = { id?: unknown; lineItems?: unknown; error?: unknown };

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  let body: { lineItems?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const requestedLineItems = Array.isArray(body?.lineItems) ? body.lineItems.length : 0;

  try {
    const data = await callVeridian<CreatedBoqResponse>("/scope", { organizationId: ctx.organizationId!, method: "POST", body });

    const savedId = typeof data?.id === "string" ? data.id.trim() : "";
    if (!savedId) {
      return NextResponse.json(
        { error: "BOQ was not created: the scope service reported success but returned no saved BOQ. Nothing has been saved — please try again." },
        { status: 502 }
      );
    }

    const savedLineItems = Array.isArray(data.lineItems) ? data.lineItems.length : 0;
    if (savedLineItems < requestedLineItems) {
      return NextResponse.json(
        { error: `BOQ was not saved correctly: ${requestedLineItems} line item(s) were submitted but only ${savedLineItems} came back saved. Check the BOQ list before retrying.` },
        { status: 502 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to create BOQ" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
