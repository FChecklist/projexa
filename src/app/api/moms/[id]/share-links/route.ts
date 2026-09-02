import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ id: string }> };

// R39/R-C04: was missing entirely -- VERIDIAN's own createMeetingShareLink
// (Wave 44) had no PROJEXA-facing route until this one. Reuses the SAME
// share-link mechanism the R-C15 fix (compliance-tracker#1331) proved
// working -- not a second share path.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  const { id } = await params;
  try {
    const data = await callVeridian(`/veri-meetings/${encodeURIComponent(id)}/share-links`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to load share links" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}

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
const PROJEXA_PUBLIC_ORIGIN = process.env.PROJEXA_PUBLIC_ORIGIN ?? "https://projexa-ai.com";

export async function POST(request: NextRequest, { params }: RouteContext) {
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
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Failed to create share link" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
