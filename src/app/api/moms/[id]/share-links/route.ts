import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

type RouteContext = { params: Promise<{ id: string }> };

type ShareLinkRow = { id: string; token: string; expiresAt: string; revokedAt: string | null; createdAt: string };

// R67 D-21: the deployment's own public origin. It defaults to the production
// domain rather than to the request's host precisely because the request's host
// is the value that was wrong; a local or preview deployment that wants its own
// links sets the variable. Declared here because BOTH verbs now use it.
const PROJEXA_PUBLIC_ORIGIN = process.env.PROJEXA_PUBLIC_ORIGIN ?? "https://projexa-ai.com";

// R67 lane D22 (item D-63): VERIDIAN's POST returns a resolved shareUrl but its
// GET returns bare tokens, so the object page could only learn a link's public
// URL by creating another one. Resolved here, server-side, so the Share
// controls can be real anchors with real hrefs on arrival instead of
// script-only buttons.
//
// MERGE NOTE: this lane built the URL from VERIDIAN's own origin and its
// /shared/meeting path. That is exactly the defect D-21 (below) found and
// fixed on the POST side -- VERIDIAN's deployment host is not the domain the
// recipient has to open, and "meeting" is VERIDIAN's word for it. So the GET
// now composes the SAME pair the POST asks VERIDIAN to use: PROJEXA's own
// public origin and PROJEXA's own /shared/mom route (compliance-tracker's
// veri-meeting-service.ts maps brand "projexa" to that path). One URL shape,
// whichever verb produced the link.
function withShareUrl(link: ShareLinkRow) {
  return { ...link, shareUrl: `${PROJEXA_PUBLIC_ORIGIN}/shared/mom/${link.token}` };
}

// R39/R-C04: was missing entirely -- VERIDIAN's own createMeetingShareLink
// (Wave 44) had no PROJEXA-facing route until this one. Reuses the SAME
// share-link mechanism the R-C15 fix (compliance-tracker#1331) proved
// working -- not a second share path.
export const GET = withTiming("GET", async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian<{ links?: ShareLinkRow[] }>(`/veri-meetings/${encodeURIComponent(id)}/share-links`, { organizationId: ctx.organizationId! });
    return NextResponse.json({ links: (data.links ?? []).map(withShareUrl) });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to load share links");
  }
});

// R67 D-21: PROJEXA now names itself and its own product domain on the way
// out. Before this, VERIDIAN composed the message and the link with nothing
// to go on but request.nextUrl.origin -- which for this server-to-server call
// is VERIDIAN's OWN deployment host, not the domain the recipient has to open
// -- and the sentence read "View these VERIDIAN AI meeting minutes" to a
// PROJEXA customer.
//
// PROJEXA_PUBLIC_ORIGIN is the deployment's own public origin. It defaults to
// the production domain rather than to the request's host precisely because
// the request's host is the value that was wrong; a local or preview
// deployment that wants its own links sets the variable.

export const POST = withTiming("POST", async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/veri-meetings/${encodeURIComponent(id)}/share-links`, {
      method: "POST", organizationId: ctx.organizationId!,
      body: { brand: "projexa", shareOrigin: PROJEXA_PUBLIC_ORIGIN },
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to create share link");
  }
});
