import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await request.json();
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  try {
    const result = await callVeridian<{ reply: string }>("/discuss", {
      organizationId: ctx.organizationId!,
      method: "POST",
      body: { message, history: body.history ?? [] },
    });
    return NextResponse.json(result);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to reach VERI AI");
  }
}
