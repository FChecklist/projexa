import { NextResponse } from "next/server";
import { requireCompanyScope } from "@/lib/company-scope";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// "Department" level: VERIDIAN's real HR departments for the selected
// company (org), same backing data as the existing /api/hr/departments
// proxy, just scoped to an explicitly-chosen (and membership-verified)
// companyId instead of the caller's default org.
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const scope = await requireCompanyScope(companyId);
  if (scope.response) return scope.response;

  try {
    const data = await callVeridian("/hr/departments", { organizationId: scope.companyId });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load departments" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
