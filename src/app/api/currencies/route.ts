import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { createCachedVeridianGet } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Priority 17 Wave 1 (multi-currency Selling & Buying): thin proxy over
// VERIDIAN's new /api/v1/projexa/currencies -- lets the Quotations, Sales
// Orders, and Purchase Orders creation forms populate a real currency
// dropdown instead of silently assuming the org's base currency.
//
// Perf, 2026-08-27: this is master/reference data ({ id, code, name, symbol,
// isBaseCurrency } -- see CurrencyRow -- no exchange rates, no live figures)
// read on nearly every money-formatting screen (dashboard, invoices,
// quotations, sales/purchase orders) and changed only when an org admin
// adds/edits a currency, which is rare. GET-only route (no POST/PUT/DELETE
// here), so caching it can't hide a write. Cached 60s, org-scoped -- see the
// security comment on createCachedVeridianGet() in veridian-client.ts for
// why that scoping is safe. A newly added currency can take up to 60s to
// appear in these dropdowns instead of being instant.
const getCachedCurrencies = createCachedVeridianGet("veridian-currencies", "/currencies", 60);

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await getCachedCurrencies(ctx.organizationId!);
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load currencies");
  }
}
