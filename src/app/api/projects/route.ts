import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// Feeds the ProjectSwitcher dropdown in AppSidebar with the org's real
// project list (id/name only -- the VERIDIAN API key itself never leaves
// veridian-client.ts / the server).
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  try {
    const data = await callVeridian<{ projects: { id: string; name: string }[] }>("/dashboard", { organizationId: ctx.organizationId! });
    return NextResponse.json({ projects: data.projects ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load projects" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
