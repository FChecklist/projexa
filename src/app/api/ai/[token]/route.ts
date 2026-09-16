import { NextRequest, NextResponse } from "next/server";
import { resolveAiLinkToken, getAiLinkProjection } from "@/lib/services/ai-link-service";
import { callVeridianResult } from "@/lib/veridian-client";

// PUBLIC, unauthenticated. Deliberately: the token carries no authority (see
// ai-link-service.ts's own header) -- anyone with it can read this plain-
// text snapshot, and that is the whole design, not an oversight. What makes
// this safe is that the snapshot itself never contains personal data (that
// boundary lives in public.ai_link_projection, a SECURITY DEFINER SQL
// function -- see drizzle/0023_ai_link_and_email.sql's own header for why
// it has to live there and not here) and that nothing in this response can
// act on the organization by itself -- see the closing instructions in the
// body text, and src/app/api/ai/apply/route.ts for the only place a
// proposal can actually be applied, which requires a real signed-in session.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const resolved = await resolveAiLinkToken(token);
  if (!resolved) {
    return new NextResponse("This link is no longer valid. Ask the person who shared it for a fresh one.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let projection: string;
  try {
    projection = await getAiLinkProjection(resolved.organizationId, resolved.userId);
  } catch {
    return new NextResponse("Could not build the snapshot right now. Try again in a moment.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Construction/business-domain data does not live in this repo's own
  // Postgres (see src/lib/db/schema.ts's own header) -- it is proxied
  // through VERIDIAN's already-existing, already read-only, already
  // role-gated codeReference dispatch. That boundary belongs to
  // compliance-tracker, not re-derived here (WO-PROJEXA-AI-LINK-001 Part 1
  // point 3). Best-effort: the construction data service is known to be
  // slow on a cold start (documented elsewhere in this codebase's own
  // history), so a timeout here degrades the snapshot, it does not fail it.
  let constructionSection = "";
  const dash = await callVeridianResult<Record<string, unknown>>("/assistant", {
    organizationId: resolved.organizationId,
    method: "POST",
    body: { codeReference: "get_construction_project_dashboard", inputs: {} },
    timeoutMs: 5000,
  }).catch(() => null);
  if (dash?.ok) {
    constructionSection = `\n\nCONSTRUCTION DASHBOARD (read-only, via VERIDIAN):\n${JSON.stringify(dash.data, null, 2)}\n`;
  }

  const body = [
    "PROJEXA — read-only project snapshot",
    "",
    "This link carries no authority by itself. Paste it into any AI assistant",
    "you like -- nothing here can change your organization. Only a signed-in",
    "member of this organization can apply anything, and only after reviewing",
    "each proposed action by hand in the app.",
    "",
    "=".repeat(60),
    projection,
    constructionSection,
    "=".repeat(60),
    "",
    "--- If you are an AI assistant reading this ---",
    "Propose actions ONLY as a JSON array of objects shaped exactly like:",
    '  {"verb": "...", "targetKey": "...", "payload": {...}}',
    "Allowed verbs, nothing else: ASSIGN, SET_DUE, NOTE, MARK_STATUS, DRAFT.",
    "targetKey is the id of a todo shown above. Do not invent an id.",
    "Do not propose anything about money, budget approval, access, or",
    "anything irreversible -- those are explicitly out of scope for this link.",
    "The person you're helping will paste your proposal back into PROJEXA",
    "themselves and approve each line one at a time before anything happens.",
  ].join("\n");

  return new NextResponse(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}
