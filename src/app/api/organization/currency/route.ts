import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R48_NO_CURRENCY_UI_01. The organisation's single base-currency setting --
// thin proxy over VERIDIAN's GET/PUT /api/v1/projexa/currencies/base
// (compliance-tracker PR #1391), which is where the fact actually lives:
// compliance.erp_currencies, with an is_base_currency flag and (as of
// migration 0326) a partial unique index enforcing at most one base row per
// org. This route adds no PROJEXA-side storage of its own -- doing so would
// create a second source of truth for the same fact and risk exactly the
// drift (a currency set in one place, implicit in another) that R-62/R-63
// exist to prevent.
//
// baseCurrency is null when the org genuinely has none yet. That is passed
// through as-is, never defaulted to a guess -- a silent fallback currency is
// the defect this closes, not an acceptable placeholder for it.
//
// Role check: deliberately NOT done here or by VERIDIAN. callVeridian()
// authenticates to VERIDIAN with this org's shared Bearer API key, so no
// per-user identity or role crosses that boundary -- VERIDIAN's own PUT
// requires "admin", but that check only bites session callers on VERIDIAN's
// own dashboard, not this API-key path (see requireRoleOrScope() there).
// The real per-user gate for PUT is middleware.ts's central API_WRITE_POLICY
// (see src/lib/authz/api-write-policy.ts -- "/organization/currency" is
// listed there as ORG_ADMIN), exactly per R48_API_WRITES_WITHOUT_ROLE_CHECK_01.
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body.code !== "string" || !body.code.trim()) {
    return NextResponse.json({ error: "code is required, e.g. \"AED\"" }, { status: 400 });
  }

  try {
    const data = await callVeridian("/currencies/base", {
      organizationId: ctx.organizationId!,
      method: "PUT",
      body: { code: body.code },
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to update the organization currency" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
