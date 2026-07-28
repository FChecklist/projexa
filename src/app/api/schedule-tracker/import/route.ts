import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianRaw, VeridianApiError } from "@/lib/veridian-client";

// Passes the multipart upload straight through to VERIDIAN (Excel parsing
// happens there, reusing this codebase's dynamic-xlsx-import pattern) --
// this route never buffers/re-encodes the file itself.
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const formData = await request.formData();
    const res = await callVeridianRaw("/construction/schedule/import", {
      organizationId: ctx.organizationId!, method: "POST", body: formData, root: true,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to import schedule" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
