import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";

// Thin proxy, same shape/reasoning as /api/capability-tree: the browser-side
// Chain Selector needs this tree, but the VERIDIAN Bearer key must never
// reach the client, so this route holds it server-side and forwards only
// the resulting node tree. Distinct from /api/capability-tree (which stays
// exactly as-is, proxying VERIDIAN's construction-only
// buildConstructionNodes() subtree for the existing "Construction
// Intelligence" mode) -- this one proxies VERIDIAN's new
// /api/v1/projexa/module-chain route, the org's full VERI GRC AI / VERI ERP
// / etc module chain, merged client-side alongside the construction tree
// (see veri-chat-context.tsx's fetchCapabilityTree()).
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ nodes: unknown[] }>("/module-chain", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load the VERIDIAN module chain");
  }
}
