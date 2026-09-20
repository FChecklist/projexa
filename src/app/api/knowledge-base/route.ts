import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// Priority 17 Wave 1: proxies to VERIDIAN /api/v1/projexa/knowledge-base
// (org-wide pages via knowledge-base-service.ts). No projectId -- this is
// deliberately not project-scoped, distinct from /api/wiki.
export const GET = withTiming("GET", async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  try {
    const data = await callVeridian("/knowledge-base", { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load knowledge base pages");
  }
});

export const POST = withTiming("POST", async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const body = await request.json();
  if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  try {
    const data = await callVeridian("/knowledge-base", { organizationId: ctx.organizationId!, method: "POST", body });
    // PROJEXA-E2E-001 cold-load fix (2026-09-21): fetchKnowledgeBasePages's
    // 30s cache (module-list-source.ts, tag "knowledge-base") would
    // otherwise leave a just-created page invisible on /knowledge-base for
    // up to 30s -- same convention as meetings/mood-boards' own POST routes.
    revalidateTag("knowledge-base");
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create knowledge base page");
  }
});
