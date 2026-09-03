import { NextResponse } from "next/server";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";

type RouteContext = { params: Promise<{ token: string }> };

// R67 D-21. Intentionally PUBLIC -- no requireAuth(). This is the download
// behind the "Download PDF" button on /shared/mom/[token], which the recipient
// of a WhatsApp link opens with no PROJEXA account of any kind. Same posture
// as the /share/report/[token] page: a plain unauthenticated fetch to
// VERIDIAN's own public, token-gated route, never callVeridian/
// callVeridianRaw, which resolve an org API key first and would defeat the
// point of a link that needs no credentials. The token is the only
// authorisation, and VERIDIAN checks it (revoked/expired/soft-deleted all 404
// there, indistinguishably).
//
// It relays bytes rather than rendering: PROJEXA must not gain a PDF library.
export async function GET(_request: Request, { params }: RouteContext) {
  const { token } = await params;
  try {
    const upstream = await fetch(`${VERIDIAN_ORIGIN}/api/veri-meetings/share/${encodeURIComponent(token)}/pdf`, { cache: "no-store" });
    if (!upstream.ok) {
      return NextResponse.json({ error: "This link has expired - ask the sender for a new one" }, { status: upstream.status === 404 ? 404 : 502 });
    }
    const pdfBuffer = await upstream.arrayBuffer();
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/pdf",
        "Content-Disposition": upstream.headers.get("Content-Disposition") ?? `attachment; filename="minutes-of-meeting.pdf"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't fetch these minutes right now - try again in a moment" }, { status: 502 });
  }
}
