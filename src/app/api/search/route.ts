import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { searchAll, EMPTY_SEARCH_RESULTS } from "@/lib/services/search-service";

// Real cross-entity search backing search-command.tsx's command palette --
// see search-service.ts for why this filters application-side instead of
// running a single SQL query the way compliance-tracker's own /api/search
// does (most of PROJEXA's entities live in VERIDIAN, not this repo's own
// Postgres).
export async function GET(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  if (!ctx.organizationId) return NextResponse.json({ query: "", total: 0, results: EMPTY_SEARCH_RESULTS });

  const { searchParams } = request.nextUrl;
  const query = (searchParams.get("q") ?? searchParams.get("search") ?? "").trim();
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit")) || 8));
  const projectId = searchParams.get("projectId");

  if (!query) return NextResponse.json({ query: "", total: 0, results: EMPTY_SEARCH_RESULTS });

  try {
    const results = await searchAll(ctx.organizationId, ctx.user!.id, projectId, query, limit);
    const total = Object.values(results).reduce((n, group) => n + group.length, 0);
    return NextResponse.json({ query, total, results });
  } catch (error) {
    console.error("Search API error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
