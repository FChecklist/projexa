import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianUpload } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// RUN R10-21AUG point 1: proxies to VERIDIAN's /scope/import (compliance-
// tracker's src/app/api/v1/projexa/scope/import/route.ts, point 2) using
// callVeridianUpload -- callVeridian JSON-encodes its body and cannot carry
// file bytes, callVeridianUpload is the only export that relays FormData and
// deliberately lets fetch set its own multipart boundary. Error shape copied
// verbatim from the sibling POST in src/app/api/scope/route.ts.
//
// R67 D-25 x R67 lane D22 (item D-52): the DRY RUN. It returns the parsed
// preview rows and their per-row problems WITHOUT writing anything, which is
// what the /scope/import screen renders -- the spreadsheet is never parsed in
// the browser, because PROJEXA must not gain an XLSX library and a second
// parser would be a second set of rules that can disagree with the one that
// imports. A dry run is a read, so it answers 200; only a real import answers
// 201, because answering 201 to a dry run is a lie the screen could act on.
//
// Two lanes spelled the flag differently -- D-25 as `?dryRun=1`, D22 as a
// `dryRun=true` FORM field -- so BOTH are read here and normalised to the query
// form VERIDIAN's route gates on. Everything else in the FormData (D22's
// `mapping` corrections included) is relayed unexamined, so a new field reaches
// VERIDIAN without this proxy needing to know what it means: the same "the
// compliance-tracker route is the one place that knows" reasoning
// /api/reports/[reportName] already documents.
export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const dryRun =
      request.nextUrl.searchParams.get("dryRun") === "1" ||
      String(formData.get("dryRun") || "") === "true";
    const data = await callVeridianUpload(`/scope/import${dryRun ? "?dryRun=1" : ""}`, formData, { organizationId: ctx.organizationId! });
    return NextResponse.json(data, { status: dryRun ? 200 : 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to import BOQ");
  }
});
