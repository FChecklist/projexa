import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 lane I (WS-I item I-05, R-177): the org's editable BOQ category list.
// A thin relay to VERIDIAN's /scope/categories -- PROJEXA stores no
// construction domain data of its own, and the list, its uniqueness rule and
// the "Used by N BOQ lines" delete refusal all live in
// construction-boq-category-service.ts on that side.
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "1";
  try {
    const data = await callVeridian(`/scope/categories${includeInactive ? "?includeInactive=1" : ""}`, {
      organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load BOQ categories" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  try {
    const data = await callVeridian("/scope/categories", { organizationId: ctx.organizationId!, method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to create BOQ category" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
