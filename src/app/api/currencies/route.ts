import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 17 Wave 1 (multi-currency Selling & Buying): thin proxy over
// VERIDIAN's new /api/v1/projexa/currencies -- lets the Quotations, Sales
// Orders, and Purchase Orders creation forms populate a real currency
// dropdown instead of silently assuming the org's base currency.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/currencies");
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load currencies" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
