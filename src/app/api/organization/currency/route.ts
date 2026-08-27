import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, ROLE_GROUPS } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R48_NO_CURRENCY_UI_01: the organisation's base currency, read and written
// as a single setting from /settings.
//
// This is a thin proxy over VERIDIAN's GET/PUT /api/v1/projexa/currencies/base
// (compliance-tracker PR #1391, 2026-08-26). That endpoint -- and the data
// behind it -- already existed before this route: compliance.erp_currencies
// holds the org's currencies with an is_base_currency flag, and provisioning
// already writes it (PR #1382). The fault row's premise ("compliance.
// organisations has no currency column") is true and was never the gap; a
// second currency column on organisations would just be a second source of
// truth for the same fact. What was missing was PROJEXA's own half: a route
// to reach VERIDIAN's setting, and the /settings control below it.
//
// GET is open to any authenticated org member (mirrors VERIDIAN's own
// "member"/"read" gate on that endpoint) -- everyone should be able to see
// what currency the org reports in. PUT is owner/admin only, gated here
// against PROJEXA's own membership role, NOT VERIDIAN's: every PROJEXA ->
// VERIDIAN call authenticates with one shared per-org API key, never a
// per-user VERIDIAN identity (see veridian-client.ts), so VERIDIAN's own
// admin check on this path only ever sees "does this org's key have write
// scope" -- the real per-user gate has to live here, same pattern as
// PATCH /api/org-members/[id].
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian("/currencies/base", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load the organization currency" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const roleError = requireRole(ctx, ROLE_GROUPS.ORG_ADMIN);
  if (roleError) return roleError;

  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(code)) {
    return NextResponse.json({ error: 'code must be a 3-letter ISO currency code, e.g. "AED"' }, { status: 400 });
  }

  try {
    const data = await callVeridian("/currencies/base", {
      method: "PUT",
      body: { code },
      organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to set the organization currency" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
