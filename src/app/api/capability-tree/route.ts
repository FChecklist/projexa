import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Thin proxy: the browser-side Chain Selector needs this tree, but the
// VERIDIAN Bearer key must never reach the client -- this route holds it
// server-side and forwards only the resulting node tree.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ nodes: unknown[] }>("/capability-tree", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof VeridianApiError ? err.message : "Failed to load capability tree from VERIDIAN";
    return NextResponse.json({ error: message }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
