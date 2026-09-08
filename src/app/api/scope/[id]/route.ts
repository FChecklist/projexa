import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { TITLE_REQUIRED_MESSAGE } from "@/lib/boq-helpers";
import { MODULE_TAGS } from "@/lib/module-list-source";
import { revalidateTag } from "next/cache";
import { withTiming } from "@/lib/with-timing";

export const GET = withTiming("GET", async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load BOQ");
  }
});

// R80/GAP-14: the BOQ header had DELETE but no field EDIT. GET and DELETE
// were the whole surface here, so a BOQ's title was write-once -- a typo made
// on the New BOQ screen was carried forward by every revision
// (createBoqRevision copies parent.title) and could only be undone by
// deleting the BOQ, which is itself draft-only. Line items already have their
// own write path (PATCH /api/scope/line-items/[id]); this is the HEADER, and
// it deliberately does not duplicate any of that.
//
// Idiom copied from the sibling proxy that already exports PATCH,
// api/scope/line-items/[id]/route.ts: requireAuth() (which resolves the
// org-scoped VERIDIAN key -- callVeridian refuses to fall back to the shared
// key for an org that has no veridian_credentials row, so the org scoping and
// the upstream's own RLS tenant context are both real), callVeridian with
// organizationId, and veridianErrorResponse for the error shape. The
// revalidateTag line is POST /api/scope's, for the same reason it gives: the
// /scope list is cached for 30 s, and a renamed BOQ that still shows its old
// title one click away reads as a failed save.
//
// WHAT MAY BE PATCHED, AND WHERE EACH RULE IS ENFORCED.
//   * Field allow-list -- HERE. Only `title` is forwarded, and any lineage or
//     workflow key present in the body is refused with a 400 rather than
//     dropped in silence. version/parentBoqId ARE the revision lineage
//     (src/lib/boq-lineage.ts walks parentBoqId to the chain root and picks
//     the Current revision by approved-then-MAX(version); the Work Progress
//     Report is priced off whatever that resolves to), status belongs to
//     submit/approve/revise, and projectId would separate the header from its
//     own line items' recorded progress.
//   * Revision state -- UPSTREAM, inside VERIDIAN's own tenant transaction
//     (updateBoq in construction-boq-service.ts), because that is the only
//     place the check cannot race the write. A superseded revision, or one
//     that already has a child revision, is refused 409. Doing that check
//     here would cost an extra round trip AND still leave a TOCTOU window.
//   * Whether to offer the control at all -- the screen
//     (ScopeObjectClient.tsx), which withholds Edit on a superseded BOQ with
//     the reason on screen, so the user never meets a button that fails after
//     the click.
const BOQ_LINEAGE_FIELDS = ["version", "status", "projectId", "parentBoqId", "lineItems"] as const;

export const PATCH = withTiming("PATCH", async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const rejected = BOQ_LINEAGE_FIELDS.filter((field) => body?.[field] !== undefined);
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        error:
          `${rejected.join(", ")} cannot be changed by editing this BOQ. ` +
          `version, parentBoqId and status are the revision lineage — use Create Revision, Submit or Approve; ` +
          `line items have their own editor; and moving a BOQ between projects would leave its recorded progress behind. Nothing was saved.`,
      },
      { status: 400 }
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: TITLE_REQUIRED_MESSAGE }, { status: 400 });
  }

  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}`, {
      organizationId: ctx.organizationId!,
      method: "PATCH",
      body: { title },
    });
    // R67 F-18: the cached list must be cleared or the row keeps its old title
    // until the 30 s window expires, which reads as a failed save.
    revalidateTag(MODULE_TAGS.scope, "max");
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update BOQ");
  }
});

// R46/E-126b: proxies to compliance-tracker's new DELETE
// /api/v1/construction/boq/[id] (draft-only -- see that route's own
// deleteBoq() comment). Needed so e2e/demo-gate-smoke.spec.ts (the ONLY
// caller today) can clean up the real BOQs it creates on every CI run
// instead of leaking them onto the shared demo project forever.
export const DELETE = withTiming("DELETE", async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/scope/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "DELETE" });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to delete BOQ");
  }
});
