import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Priority 16 Part 2 (PROJEXA-SCHEDULE-NO-CREATE-UI): proxies to the new
// VERIDIAN /api/v1/projexa/schedule/types route so the "New Task" dialog can
// populate a real type dropdown.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/schedule/types", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load task types" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
