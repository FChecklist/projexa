import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianUpload, VeridianApiError } from "@/lib/veridian-client";

// R67 lane D22 (item D-48, rec R-123): the programme (schedule) importer's
// proxy, replacing the dead src/app/api/schedule-tracker/import/route.ts --
// that one posted to VERIDIAN's /construction/schedule/import, a path that has
// never existed, so every call it ever made 404'd.
//
// callVeridianUpload is the only client export that relays FormData and lets
// fetch set its own multipart boundary (callVeridian JSON-encodes its body and
// cannot carry file bytes). The whole FormData is relayed unexamined, so
// dryRun reaches VERIDIAN without this proxy needing to know what it means --
// the same reasoning /api/scope/import and /api/reports/[reportName] already
// document. Parsing stays in compliance-tracker: PROJEXA must not gain an XLSX
// library.
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const dryRun = String(formData.get("dryRun") || "") === "true";
    const data = await callVeridianUpload("/schedule/import", formData, { organizationId: ctx.organizationId! });
    // A dry run creates nothing; answering 201 to it would be a lie the import
    // screen could reasonably act on.
    return NextResponse.json(data, { status: dryRun ? 200 : 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to import the programme" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
