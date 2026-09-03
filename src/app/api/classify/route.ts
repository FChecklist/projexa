import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

// R67 WS-C (C-03/C-05) -- THE PREVIEW. PROJEXA's proxy to VERIDIAN's
// /api/v1/projexa/classify.
//
// *** THIS ENDPOINT NEVER EXECUTES ANYTHING. *** It answers one question:
// "if I submitted this text, what would happen?" -- and VERIDIAN's own
// handler puts `executed: false` in every response body so a caller cannot
// forget. Classifying "approve VO-014" does not approve VO-014.
//
// It exists because the composer must be able to say "I read this as ..."
// BEFORE anything is written. Posting to /api/tasks to find out would write
// the very row the confirmation step exists to withhold.
//
// It goes through this proxy rather than the browser calling VERIDIAN
// directly (decision D-04): the org API key stays server-side.
//
// Response shape (VERIDIAN's classify-only.ts, contract frozen in
// platform.claude_log id 28):
//   { segments: [{ index, text, verdict: "task"|"chat"|"gap", functionId,
//                  params, missingParams, derivedChain, source, level,
//                  message, reason }],
//     flagged, l0HitRate, modelCalls, executed: false }

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });
  }
  const rawInput = typeof (body as { rawInput?: unknown }).rawInput === "string"
    ? ((body as { rawInput: string }).rawInput)
    : "";
  if (rawInput.trim().length === 0) {
    return NextResponse.json({ error: "Type what you need first" }, { status: 400 });
  }

  try {
    const data = await callVeridian("/classify", {
      method: "POST",
      body,
      organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data);
  } catch (err) {
    // The backend's OWN words, never a generic failure and never an empty
    // result rendered as "nothing matched" -- a caller must be able to tell
    // "I could not understand that" from "I could not reach the service".
    return NextResponse.json(
      { error: err instanceof VeridianApiError ? err.message : "Couldn't reach the classifier" },
      { status: err instanceof VeridianApiError ? err.status : 502 }
    );
  }
}
