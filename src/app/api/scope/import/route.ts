import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianUpload, VeridianApiError } from "@/lib/veridian-client";

// RUN R10-21AUG point 1: proxies to VERIDIAN's /scope/import (compliance-
// tracker's src/app/api/v1/projexa/scope/import/route.ts, point 2) using
// callVeridianUpload -- callVeridian JSON-encodes its body and cannot carry
// file bytes, callVeridianUpload is the only export that relays FormData and
// deliberately lets fetch set its own multipart boundary. Error shape copied
// verbatim from the sibling POST in src/app/api/scope/route.ts.
//
// R67 lane D22 (item D-52): the whole FormData is relayed unexamined, so the
// new dryRun and mapping fields reach VERIDIAN without this proxy needing to
// know what they mean -- the same "the compliance-tracker route is the one
// place that knows" reasoning /api/reports/[reportName] already documents.
// The status is no longer hardcoded to 201: a dry run creates nothing, and
// answering 201 to it would be a lie the import screen could reasonably act on.
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const dryRun = String(formData.get("dryRun") || "") === "true";
    const data = await callVeridianUpload("/scope/import", formData, { organizationId: ctx.organizationId! });
    return NextResponse.json(data, { status: dryRun ? 200 : 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to import BOQ" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
