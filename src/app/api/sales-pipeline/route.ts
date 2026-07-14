import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/sales-pipeline");
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load sales pipeline overview" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
