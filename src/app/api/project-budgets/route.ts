import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// GET-only. Creating a budget (POST /projexa/project-budgets) requires a
// fiscalYearId and costCenterId that already exist in VERIDIAN's ERP
// module -- there is no v1 endpoint anywhere (checked /api/v1/erp/*) to
// list or create fiscal years or cost centers, so a create-form here would
// just be asking the user to guess an opaque ID. Real gap, not something
// this PR's scope can close -- flagged back rather than faked.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/project-budgets");
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load budgets" }, { status: 502 });
  }
}
