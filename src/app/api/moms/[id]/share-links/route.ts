import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError, VERIDIAN_ORIGIN } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

type ShareLinkRow = { id: string; token: string; expiresAt: string; revokedAt: string | null; createdAt: string };

// R67 lane D22 (item D-63): VERIDIAN's POST returns a resolved shareUrl but its
// GET returns bare tokens, so the object page could only learn a link's public
// URL by creating another one. The URL is `${VERIDIAN_ORIGIN}/shared/meeting/
// <token>` -- exactly what the POST route builds from its own request origin
// -- so the proxy can resolve it here, server-side, and the Share controls can
// be real anchors with real hrefs on arrival instead of script-only buttons.
function withShareUrl(link: ShareLinkRow) {
  return { ...link, shareUrl: `${VERIDIAN_ORIGIN}/shared/meeting/${link.token}` };
}

// R39/R-C04: was missing entirely -- VERIDIAN's own createMeetingShareLink
// (Wave 44) had no PROJEXA-facing route until this one. Reuses the SAME
// share-link mechanism the R-C15 fix (compliance-tracker#1331) proved
// working -- not a second share path.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian<{ links?: ShareLinkRow[] }>(`/veri-meetings/${encodeURIComponent(id)}/share-links`, { organizationId: ctx.organizationId! });
    return NextResponse.json({ links: (data.links ?? []).map(withShareUrl) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load share links" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/veri-meetings/${encodeURIComponent(id)}/share-links`, {
      method: "POST", organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to create share link" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
