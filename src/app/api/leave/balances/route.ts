import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/leave/balances");
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load leave balances" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  try {
    const data = await callVeridian("/leave/balances", { method: "POST", body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to set leave balance" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
