import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianUpload, VeridianApiError } from "@/lib/veridian-client";

// R67 lane D22 (item D-68, rec R-258): the labour roster importer's proxy, the
// third and last of the three (BOQ, programme, roster) this app needs.
//
// callVeridianUpload is the only client export that relays FormData and lets
// fetch set its own multipart boundary (callVeridian JSON-encodes its body and
// cannot carry file bytes). The whole FormData is relayed unexamined, so
// dryRun / skipRowsWithErrors / createVendors reach VERIDIAN without this proxy
// needing to know what they mean -- the same reasoning /api/scope/import and
// /api/schedule/import already document. Parsing stays in compliance-tracker:
// PROJEXA must not gain an XLSX library.
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const dryRun = String(formData.get("dryRun") || "") === "true";
    const data = await callVeridianUpload("/labour/import", formData, { organizationId: ctx.organizationId! });
    // A dry run creates nothing; answering 201 to it would be a lie the import
    // screen could reasonably act on.
    return NextResponse.json(data, { status: dryRun ? 200 : 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to import the roster" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
