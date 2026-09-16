import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getMyAiLink, getOrCreateMyAiLink, rotateMyAiLink, revokeMyAiLink } from "@/lib/services/ai-link-service";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";

function toPublicUrl(token: string): string {
  return `${APP_URL}/api/ai/${token}`;
}

// GET: the caller's own current link, or null if they've never made one.
export async function GET() {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  if (!ctx.user || !ctx.organizationId) return NextResponse.json({ link: null });

  const row = await getMyAiLink(ctx.organizationId, ctx.user.id);
  return NextResponse.json({ link: row ? { url: toPublicUrl(row.token), createdAt: row.createdAt } : null });
}

// POST { action: "create" | "rotate" | "revoke" }
export async function POST(request: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  if (!ctx.user || !ctx.organizationId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const action = body?.action ?? "create";

  if (action === "revoke") {
    await revokeMyAiLink(ctx.organizationId, ctx.user.id);
    return NextResponse.json({ link: null });
  }

  const row =
    action === "rotate"
      ? await rotateMyAiLink(ctx.organizationId, ctx.user.id)
      : await getOrCreateMyAiLink(ctx.organizationId, ctx.user.id);

  return NextResponse.json({ link: { url: toPublicUrl(row.token), createdAt: row.createdAt } });
}
