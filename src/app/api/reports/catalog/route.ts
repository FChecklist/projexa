import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// PROJEXA Reports & Analysis catalog UI (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16): thin proxy over VERIDIAN's
// GET /api/v1/projexa/reports/catalog, which itself wraps the same
// getFullReportCatalog() compliance-tracker's own #375 UI already uses --
// no new business logic here, matching every other proxy route in this
// directory (e.g. api/companies/route.ts, api/quotations/route.ts).
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/reports/catalog", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load report catalog" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
