import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 F-02 (R-018/R-021/R-030/R-035). The drawings register used to receive a
// Supabase Storage signed URL for EVERY row, minted inside the list request:
// latency scaled with register size, and one Storage misconfiguration turned
// the whole register into a 500. The list now reports `hasDocument`, and this
// relay mints the URL for the one drawing somebody actually clicked.
//
// Thin proxy, same shape as every other route in this directory: the VERIDIAN
// API key stays server-side, and the backend's own words are what the user
// reads on failure.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;

  try {
    const data = await callVeridian<{ documentUrl: string; isExternalLink: boolean }>(
      `/drawings/${encodeURIComponent(id)}/document-url`,
      { organizationId: ctx.organizationId! }
    );
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Couldn't open this drawing's file" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
