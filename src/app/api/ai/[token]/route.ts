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

// A pipeline_tasks row, exactly as GET /tasks (compliance-tracker's
// src/app/api/v1/projexa/tasks/route.ts) already decorates and returns it --
// only the fields this section actually renders are typed here.
type TaskRow = {
  id: string;
  status: string;
  label: string | null;
  functionId: string | null;
  rawInput: string | null;
};

// PROJEXA-E2E-001 / WO-PROJEXA-AI-LINK-001 follow-up (2026-09-21) -- Bug 1 +
// Bug 2 fix.
//
// BUG 1 (the orphaned data model). This section used to come from
// ai_link_projection()'s own "TODOS:" block, reading PROJEXA's local
// public.todos -- a table with no reachable screen anywhere in the current
// UI (VeriChatPanel.tsx, the only component that ever rendered it, has been
// dead code since the R52 M24Shell rewrite). The REAL, currently-live task
// system is compliance.pipeline_tasks (M24's Task Master, what the app's
// actual "Tasks" tab shows) -- but that table lives in a different Supabase
// project than this repo's own Postgres (compliance-tracker's
// pcrjmlpuqsbocqfwoxod vs this repo's evpckeuxgvahguwsaeul), so
// ai_link_projection() (a SQL function) cannot query it directly. This
// section is built here instead, in TypeScript, the exact same way the
// CONSTRUCTION DASHBOARD section below already reaches cross-repo data --
// GET /tasks, VERIDIAN's already-existing, already read-only, already
// org-scoped proxy to pipeline_tasks (src/app/api/tasks/route.ts is
// PROJEXA's own authenticated proxy to the identical endpoint; this call
// authenticates the same way, with the org's own VERIDIAN API key).
// drizzle/0027_ai_link_projection_drops_todos.sql is this fix's other half
// -- it drops the todos section from ai_link_projection() itself.
//
// BUG 2 (no usable id). Each line below renders the task's REAL id in a
// `[id: ...]` prefix a reading AI can parse straight out of the text, not
// just the human-readable label -- see the closing instructions, updated to
// point at this exact format.
async function buildTasksSection(organizationId: string): Promise<string> {
  const result = await callVeridianResult<{ tasks: TaskRow[] }>("/tasks?limit=20", {
    organizationId,
    method: "GET",
    timeoutMs: 5000,
  }).catch(() => null);

  if (!result?.ok) {
    // Best-effort, same posture as the dashboard section below: a slow or
    // unreachable upstream degrades the snapshot, it does not fail it.
    return "\n\nTASKS: (could not load right now -- try again in a moment)\n";
  }

  const tasks = result.data.tasks ?? [];
  if (tasks.length === 0) {
    return "\n\nTASKS (live, from the app's own Tasks tab):\n(none)\n";
  }

  const lines = tasks.map((t) => {
    const label = t.label ?? t.functionId ?? "(unlabeled task)";
    const detail = t.rawInput ? `: ${t.rawInput}` : "";
    return `- [id: ${t.id}] ${label} (status: ${t.status})${detail}`;
  });

  return `\n\nTASKS (live, from the app's own Tasks tab):\n${lines.join("\n")}\n`;
}

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

  const tasksSection = await buildTasksSection(resolved.organizationId);

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
    tasksSection,
    constructionSection,
    "=".repeat(60),
    "",
    "--- If you are an AI assistant reading this ---",
    "Propose actions ONLY as a JSON array of objects shaped exactly like:",
    '  {"verb": "...", "targetKey": "...", "payload": {...}}',
    "Allowed verbs, nothing else: ASSIGN, SET_DUE, NOTE, MARK_STATUS, DRAFT.",
    "targetKey is the id of one of the TASKS listed above -- the value inside",
    '[id: ...] at the start of its line (e.g. for "- [id: abc123] Record',
    'progress (status: to_do)", targetKey is "abc123"). Do not invent an id,',
    "and do not use a label or a number from elsewhere in this document.",
    "Not every verb has a real target on every task -- ASSIGN, SET_DUE and",
    "NOTE are not supported yet (the live task record has no assignee, due",
    "date or note field) and will be refused; MARK_STATUS ({\"done\": true}",
    'or {"done": false}) and DRAFT (recorded, applies nothing further) do',
    "work.",
    "Do not propose anything about money, budget approval, access, or",
    "anything irreversible -- those are explicitly out of scope for this link.",
    "The person you're helping will paste your proposal back into PROJEXA",
    "themselves and approve each line one at a time before anything happens.",
  ].join("\n");

  return new NextResponse(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}
