import { NextResponse } from "next/server";
import { requireCompanyScope } from "@/lib/company-scope";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// "Department" level: VERIDIAN's real HR departments for the selected
// company (org), same backing data as the existing /api/hr/departments
// proxy, just scoped to an explicitly-chosen (and membership-verified)
// companyId instead of the caller's default org.
export const GET = withTiming("GET", async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const scope = await requireCompanyScope(companyId);
  if (scope.response) return scope.response;

  try {
    const data = await callVeridian("/hr/departments", { organizationId: scope.companyId });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load departments");
  }
});
