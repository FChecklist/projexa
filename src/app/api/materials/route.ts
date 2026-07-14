import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// GET-only: the v1 materials alias only re-exports the read-side stock
// ledger (see that route's own comment) -- receipts/issues stay on the
// generic /api/v1/erp/inventory/{receipts,issues} paths, which need a
// warehouseId/itemId with no discovery API exposed to PROJEXA either, so a
// create-form here would just be guesswork IDs. Listing only, honestly.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/materials");
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load materials" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
