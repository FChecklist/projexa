import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian } from "@/lib/veridian-client";
import { veridianErrorResponse } from "@/lib/veridian-response";
import { withTiming } from "@/lib/with-timing";

// R52: PROJEXA's proxy to VERIDIAN's task surface. This is the route
// error_log E-120 said did not exist -- "projexa has NO /api/tasks route", so
// Task Master had no data source and the composer had nowhere to submit.
//
// THE DATA SOURCE IS RULED, AND IT IS NOT THE OBVIOUS ONE. M24 rules Task
// Master reads compliance.pipeline_tasks -- what the composer creates and what
// carries the chain -- NOT compliance.tasks, a different, older system with
// 1,913 rows. VERIDIAN's /api/v1/projexa/tasks reads pipeline_tasks. PROJEXA
// also has an /api/todos route that reads the older system; wiring Task Master
// to that would have looked right and contradicted the ruling, so it was
// deliberately left alone (recorded in claude_log id=29).
//
// Contract from R53's handshake, claude_log id=35, captured by calling
// production rather than transcribed from source.

export const dynamic = "force-dynamic";

// GET -- Task Master's list. Returns { counts, groups, tasks }.
//
// `counts` and `groups` are the SAME rows, which is why the header tabs can
// never disagree with the list beneath them. M24 requires live counts on the
// tabs so the user knows before clicking; this is where they come from.
export const GET = withTiming("GET", async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(req.url);
  const qs = new URLSearchParams();
  // R67 F-26 (R-242): `cursor` pages the list. It is an opaque token minted by
  // VERIDIAN's own task-cursor.ts and forwarded verbatim; nothing here parses
  // it, and a token the backend no longer understands starts from the top
  // rather than failing the read.
  for (const k of ["projectId", "status", "limit", "cursor"]) {
    const v = searchParams.get(k);
    if (v) qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  try {
    const data = await callVeridian(`/tasks${suffix}`, { organizationId: ctx.organizationId! });
    return NextResponse.json(data);
  } catch (err) {
    // The backend's OWN words, never a generic failure. An empty list rendered
    // in place of an error is the specific defect this app has shipped before.
    return veridianErrorResponse(err, "Failed to load tasks");
  }
});

// POST -- the composer's submit target. Takes EITHER shape:
//   typed path: { rawInput, mode, projectId, selectedChain? }
//   pill path:  { functionId, params, mode, projectId }   <- no classifier,
//                                                            no model call
//
// The response's `verdict` is PER TASK, not per submission: one message can
// return one "task" and one "chat". Callers must not collapse that into a
// single verdict for the message -- R53 records that as the exact defect it
// removed, where a submission silently dropped half of what the user asked for.
export const POST = withTiming("POST", async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });
  }

  try {
    const data = await callVeridian("/tasks", {
      method: "POST",
      body,
      organizationId: ctx.organizationId!,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return veridianErrorResponse(err, "Failed to submit");
  }
});
