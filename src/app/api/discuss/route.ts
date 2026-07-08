import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await request.json();
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  try {
    const result = await callVeridian<{ reply: string }>("/discuss", {
      method: "POST",
      body: { message, history: body.history ?? [] },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof VeridianApiError ? err.message : "Failed to reach VERI AI";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
