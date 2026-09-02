import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/documents/${encodeURIComponent(id)}/dispose`, { organizationId: ctx.organizationId!, method: "POST", root: true });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to dispose document");
  }
}
