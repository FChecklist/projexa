import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianUpload, VeridianApiError } from "@/lib/veridian-client";

// R67 D-34 (R-091): bulk roster load. Thin multipart relay to VERIDIAN's
// /labour-roster/import -- callVeridian JSON-encodes its body and cannot carry
// file bytes, callVeridianUpload is the only export that relays FormData and
// deliberately lets fetch set its own multipart boundary. Same shape as the
// BOQ import proxy this is modelled on.
//
// `?dryRun=1` is forwarded unchanged: it returns the parsed preview rows and
// their per-row problems WITHOUT writing anything, which is what the
// /labour/import screen renders. The spreadsheet is never parsed in the
// browser -- PROJEXA must not gain an XLSX library, and a second parser would
// be a second set of rules that can disagree with the one that imports. A dry
// run is a read, so it answers 200; only a real import answers 201.
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const formData = await request.formData();
    const data = await callVeridianUpload(`/labour-roster/import${dryRun ? "?dryRun=1" : ""}`, formData, { organizationId: ctx.organizationId! });
    return NextResponse.json(data, { status: dryRun ? 200 : 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to import the roster" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
