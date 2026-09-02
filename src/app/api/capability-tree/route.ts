import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

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
    return veridianErrorResponse(err, "Failed to load capability tree from VERIDIAN");
  }
}
