import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { MODULE_TAGS } from "@/lib/module-list-source";
import { revalidateTag } from "next/cache";
import { withTiming } from "@/lib/with-timing";

export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  // R67 F-23 (R-239): `?include=variation` asks VERIDIAN to compute each
  // revision's variation-vs-prior in the SAME query as the list, replacing the
  // one /api/scope/{id}/compare request PER ROW the /scope screen used to make
  // just to fill one cell. Only the recognised value is forwarded, so this
  // proxy can never pass an arbitrary string through to the upstream URL.
  const include = request.nextUrl.searchParams.get("include") === "variation" ? "&include=variation" : "";
  try {
    const data = await callVeridian(`/scope?projectId=${encodeURIComponent(projectId)}${include}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load scope of work");
  }
});

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

export const POST = withTiming("POST", async function POST(request: NextRequest) {
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

    // R67 F-18: the cached list must be cleared or the new row is
    // invisible until the 30 s window expires, which reads as a failed save.
    revalidateTag(MODULE_TAGS.scope, "max");
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create BOQ");
  }
});
