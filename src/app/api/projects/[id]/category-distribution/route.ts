import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import {
  buildCategoryDistribution,
  type CategoryBoqAmounts,
  type CategoryProgress,
} from "@/lib/category-distribution";

// R67 E-29 (R-255). The project-scoped twin of
// /api/dashboard-hierarchy/companies/[companyId]/projects/[projectId]/category-distribution.
//
// WHY IT HAS TO EXIST. R-255 asks for the category chart on the PROJECT
// dashboard. The only route that combined the two category reports was
// company-scoped, and the project dashboard has a project and no company --
// so the chart could not be mounted there at all. This route asks the same two
// real VERIDIAN reports for the same project and combines them through the
// SAME pure function (src/lib/category-distribution.ts), so the two screens
// cannot show different numbers for one BOQ.
//
// The combination stays on the SERVER, on both routes, for the reason every
// other report on this product does: the browser is not where a figure gets
// derived, and a second derivation is a second thing to keep in step.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const projectId = encodeURIComponent(id);

  try {
    const [amounts, progress] = await Promise.all([
      callVeridian<CategoryBoqAmounts>(`/reports/category-boq-amounts?projectId=${projectId}`, {
        organizationId: ctx.organizationId!,
      }),
      callVeridian<CategoryProgress>(`/reports/category-progress?projectId=${projectId}`, {
        organizationId: ctx.organizationId!,
      }),
    ]);
    return NextResponse.json(buildCategoryDistribution(amounts, progress));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load category distribution" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
