import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 D-34 (R-085): the trade picklist. Trade was a free-text input, so the
// same job arrived as "Mason", "mason" and "Masonry" and every trade-wise total
// downstream split. VERIDIAN returns the seed vocabulary merged with whatever
// this org has actually used, so turning the input into a Select never hides a
// trade someone already typed.
export async function GET(_request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/labour-roster/trades", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load the trade list" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
