import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R67 F-07 (R-100/R-106). This route is deliberately KEPT: the EXPORTABLE
// report has no loaded page to derive from, so it runs here -- one grouped SQL
// aggregate in one transaction.
//
// R67 E-05 (R-103): the Cost Report gained a PERIOD and a GROUPING, so the
// proxy carries them. Forwarded rather than interpreted -- compliance-tracker's
// own route is the one place that decides what a missing or nonsensical
// parameter means, and duplicating that judgement here is how the two ends
// start disagreeing.
//
// MERGE NOTE (2026-09-03): F-07's optimisation was to derive the on-screen tab
// from the receipts the browser already holds. E-05 then made that tab a real
// parameterised report -- a date window, a Material|Vendor grouping, a vendor
// NAME per row and the exclusion of VOIDED receipts. None of those can be
// derived from the rows a list screen happens to have loaded, so the tab reads
// this route again. F-07's buildMaterialCostReport stays in
// src/lib/material-cost-report.ts for the unfiltered roll-up.
export const GET = withTiming("GET", async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  // R67 D-57 + E-05: the From/To parameter bar and the Material|Vendor
  // grouping. All optional and all forwarded intact -- VERIDIAN filters and
  // groups in the aggregate, so this never pulls a project's whole receipt
  // history back to narrow it here.
  const search = new URLSearchParams({ projectId });
  for (const key of ["from", "to", "groupBy"] as const) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) search.set(key, value);
  }

  try {
    const data = await callVeridian(`/construction/materials/cost-report?${search.toString()}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load material cost report");
  }
});
