import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// PROJEXA Reports & Analysis catalog UI (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16): thin proxy over VERIDIAN's
// GET /api/v1/projexa/reports/catalog, which itself wraps the same
// getFullReportCatalog() compliance-tracker's own #375 UI already uses --
// no new business logic here, matching every other proxy route in this
// directory (e.g. api/companies/route.ts, api/quotations/route.ts).
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/reports/catalog", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load report catalog");
  }
});
