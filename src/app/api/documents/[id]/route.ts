import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Real-screen conversion (2026-08-30): the Documents list never had a
// detail route -- a file could be uploaded but never viewed/downloaded
// again. Proxies to VERIDIAN's new /v1/projexa/documents/[id] (root: true,
// same as the list route -- lives at /api/v1/documents, not
// /api/v1/projexa/documents).
export const GET = withTiming("GET", async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/documents/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load document");
  }
});

export const PATCH = withTiming("PATCH", async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  const body = await request.json();
  try {
    const data = await callVeridian(`/documents/${encodeURIComponent(id)}`, { organizationId: ctx.organizationId!, method: "PATCH", body, root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to update document");
  }
});
