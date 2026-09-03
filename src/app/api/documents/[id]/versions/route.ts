import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridianUpload, VeridianApiError } from "@/lib/veridian-client";

// R67 D-15 (audit R-040). "Replace file" on the document object page: a new
// VERSION of the same logical document, not a second document.
//
// Multipart relay, exactly like the permits and drawings upload proxies --
// callVeridian JSON-encodes its body and cannot carry file bytes.
// compliance-tracker's createDocumentVersion() does the real work (flip the
// previous row's isLatestVersion and insert the new one inside ONE tenant
// transaction), so this route adds nothing but the org's own Bearer key.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const formData = await request.formData();
    const data = await callVeridianUpload(`/documents/${encodeURIComponent(id)}/versions`, formData, {
      organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to replace this document's file" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
