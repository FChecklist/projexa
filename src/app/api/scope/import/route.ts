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
export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const data = await callVeridianUpload("/scope/import", formData, { organizationId: ctx.organizationId! });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to import BOQ");
  }
});
