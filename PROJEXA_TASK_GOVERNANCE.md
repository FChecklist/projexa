# PROJEXA Task Governance

**Version 1.0 — 2026-07-11.** PROJEXA's own governance-documentation bootstrap,
establishing the same baseline `FChecklist/compliance-tracker` (VERIDIAN AI OS) has:
`AGENTS.md` (who may write code here and under what rules) plus this document (what AI
capability exists in this repo today, and how task-like state here relates to
VERIDIAN's Universal Task Lifecycle work). Written from PROJEXA's own code, not
copy-pasted from VERIDIAN's constitutional documents — this repo does not have
`roster.ts`, Orchestra Layers, `orchestraExecutions`, or any of VERIDIAN's other
AI-OS machinery, and this document does not pretend otherwise.

Same honesty discipline as `compliance-tracker`'s three constitutional documents
(`VERIDIAN_AI_CONSTITUTION.md`, `MASTER_AI_OS_ARCHITECTURE.md`,
`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`): **[ENFORCED]** means a real mechanism in
this repo's own code backs the claim, cited by file path. **[NOT APPLICABLE YET]**
means there is genuinely nothing in this codebase for the rule to bind to. No section
below claims enforcement that isn't real.

---

## 1. Does PROJEXA have any AI/LLM features today?

**Yes, but only as a thin proxy client — PROJEXA itself makes zero direct model-provider
calls.**

Verified by repo-wide search of `src/` for `callLLM`, `OpenRouter`/`openrouter`,
`OPENAI`, `Anthropic`/`anthropic`, `GROQ`, and any `fetch` to a
`chat/completions`-shaped endpoint: **no matches**. There is no local LLM client, no
`OPENROUTER_API_KEY`/`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` in `.env.local`, and no
prompt-construction code in this repository.

What actually exists:

- **`src/lib/veridian-client.ts`** — `callVeridian()`, the single function through
  which every AI-adjacent feature in PROJEXA operates. It sends a Bearer-authenticated
  `fetch` to `VERIDIAN_API_BASE_URL` (default:
  `https://veridian-compliance-ai.vercel.app/api/v1/projexa`) — i.e., PROJEXA delegates
  *all* AI reasoning to VERIDIAN's own API, which is where VERIDIAN's own AI governance
  (`VERIDIAN_AI_CONSTITUTION.md`, prompt security, multi-tenant isolation) actually
  applies.
- **`src/app/api/assistant/route.ts`** — proxies to VERIDIAN's `/assistant` endpoint
  (`POST /api/v1/projexa/assistant`, referenced in this route's own comment as
  "VERIDIAN's Wave 129"). Records a local history row in `assistant_queries`
  (see §2) before and after the call.
- **`src/app/api/discuss/route.ts`** — proxies to VERIDIAN's `/discuss` endpoint for
  free-text chat ("VERI AI" in the UI).
- **`src/components/veri-chat/*`** — the client-side chat UI (Mode Pills / Chain
  Selector / Chatbox), explicitly a UI port of VERIDIAN's own chat composer design
  (commit `e1aaf06`, "Port VERIDIAN's Mode Pills / Chain Selector / Chatbox to
  PROJEXA"), not an independent AI implementation.

**MVP-stage caveat, stated in the code itself** (`veridian-client.ts` comment,
`src/app/api/assistant/route.ts` comment): every PROJEXA org currently shares one
demo `VERIDIAN_API_KEY` — per-organization credential lookup
(`getVeridianApiKey()` / `veridian_credentials` table) exists in the schema but is not
yet wired into the live call path, since that needs `DATABASE_URL`/service-role access
that isn't configured. This is a real, named gap, not fabricated to sound more finished
than it is.

### Guardrail discipline: what should apply here, and doesn't yet

**[NOT APPLICABLE YET]** — `task-tightening.ts`'s `TightTask` pattern
(`compliance-tracker/src/lib/task-tightening.ts`: a task must carry a real
`objective`/`scope`/`successCriteria` before it's dispatched to a model, rejecting
empty or placeholder fields) has no PROJEXA equivalent. Nothing in
`src/app/api/assistant/route.ts` or `src/app/api/discuss/route.ts` validates the shape
of `codeReference`/`inputs` or `message` before forwarding to VERIDIAN — both routes
check only that the field is a non-empty string.

This is a real gap worth closing, but it should be closed **at the point that
actually matters**: because PROJEXA doesn't call a model directly, the
objective/scope/success-criteria discipline has to live on VERIDIAN's side of the
`/assistant` and `/discuss` endpoints (where the prompt is actually assembled and sent
to a model) — VERIDIAN's own `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` §4 already
names that pattern and where it's enforced today (AI Dev Team dispatch,
`ai-workforce-agent.mjs`). Retrofitting `TightTask` onto PROJEXA's proxy routes without
also checking whether VERIDIAN's `/api/v1/projexa/assistant` handler validates its own
input would be theater — validating a shape client-side while the real model call
happens in a different repo, behind an API key, with its own (currently unverified)
input handling.

**Follow-up confirmed, 2026-07-12 (VERIDIAN Priority 7):** checked both handlers
directly in `compliance-tracker`.

- `POST /api/v1/projexa/assistant` (`src/app/api/v1/projexa/assistant/route.ts`) never
  calls a model at all — it forwards `codeReference` through `dispatchTool()`
  (`task-execution-engine.ts`), restricted to a fixed allowlist of 7 deterministic
  construction compute functions (`get_construction_project_dashboard`,
  `list_delayed_activities`, etc. — pure DB reads/aggregations, zero LLM calls in the
  dispatch path). `TightTask`'s objective/scope/success-criteria discipline exists to
  tighten instructions handed to a *model*; there is no model call here for it to
  protect, so `[NOT APPLICABLE YET]` for this route is actually the correct, permanent
  answer, not a temporary gap.
- `POST /api/v1/projexa/discuss` (`src/app/api/v1/projexa/discuss/route.ts`) **does**
  call a model, via `discussConstruction()`
  (`compliance-tracker/src/lib/services/construction-ai-service.ts`). That function
  already calls `enforcePolicy()` (`compliance-tracker/src/lib/policy-enforcement-engine.ts`)
  before the model is invoked — the same guardrail class VERIDIAN's own VERI Chat
  reply paths use for free-text conversation (`chat-service.ts`'s `generateAiReply()`/
  `generateVeriGroupReply()`), not `TightTask`. `TightTask` is the right guardrail for
  *task dispatch* (build/fix work handed to the AI Dev Team with an
  objective/scope/success-criteria); it is the wrong tool for a conversational chat
  message, which is what `/discuss` is. `[ENFORCED, correctly, via the right
  guardrail]` — not a gap, just previously an unanswered question.

**Corrected bottom line**: there is no code gap on VERIDIAN's side for this endpoint
pair. The original `[NOT APPLICABLE YET]` framing above conflated "no `TightTask`" with
"no guardrail" — `TightTask` was simply never the applicable guardrail for either route.

---

## 2. Task Lifecycle

**Real schema, PROJEXA's own** (`src/lib/db/schema.ts`):

- **`assistant_queries`** — `{ id, organizationId, createdBy, codeReference, breadcrumb,
  inputs (jsonb), result (jsonb), status, errorMessage, createdAt }`, with
  `status` constrained by the migration (`drizzle/0002_assistant_queries_chat_todo.sql`)
  to `'pending' | 'done' | 'error'`. This is the closest thing PROJEXA has to a task
  concept, and its own code comment says exactly what it is: *"Local history of
  dispatched `/api/v1/projexa/assistant` calls. Stands in for VERIDIAN's real async
  Tasks system: `dispatchTool()` is synchronous and VERIDIAN's `createTask()` requires
  a real user session (not an API key), which PROJEXA's server-side proxy calls don't
  have."* In other words: this table exists because PROJEXA *can't* use VERIDIAN's real
  task system yet (an API-key-authenticated server call can't create a
  session-authenticated VERIDIAN task), not because it's a deliberate, independent task
  model.
- **`todos`** — `{ id, organizationId, userId, text, done, createdAt }`. A flat
  per-user checklist (boolean `done`), unrelated to AI dispatch — no status enum, no
  lifecycle beyond done/not-done. Worth naming so it isn't confused with
  `assistant_queries` — they solve different problems.

**Mapping to VERIDIAN's Universal Task Lifecycle work
(`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` §2), honestly:**

| VERIDIAN concept | PROJEXA equivalent | Gap |
|---|---|---|
| `tasks.status` (`pending\|in_progress\|completed\|failed\|cancelled`) | `assistant_queries.status` (`pending\|done\|error`) | Narrower enum (3 states, no `in_progress`/`cancelled`); scoped to one dispatch call, not a general task object. |
| `taskAgentExecutions` (per-step execution record) | none | **[NOT APPLICABLE YET]** — `assistant_queries` is a single row per call, not a multi-step execution plan. |
| Risk Assessment / `detectHighImpactAction()` | none | **[NOT APPLICABLE YET]** — no confirmation gate exists before an `assistant_queries` row is created or dispatched. |
| Objective/Scope/Instruction Validation guardrails (`task-tightening.ts`) | none | See §1 above — confirmed 2026-07-12: `assistant` never calls a model (no gap to have), `discuss` calls a model and is already guarded via `enforcePolicy()`, the correct guardrail class for conversational chat. Not a gap. |
| 18-stage lifecycle (Request → ... → Closed) | none | **[NOT APPLICABLE YET]** — VERIDIAN's own constitution already marks the full 18-stage lifecycle `[POLICY ONLY]` even in its own repo; PROJEXA is further behind that, not closer. |

**Bottom line, stated plainly**: PROJEXA does not yet have a task lifecycle in the
sense VERIDIAN's governance work means the term. It has a call-history log
(`assistant_queries`) that its own authors already flagged as a stand-in for something
that doesn't exist yet, plus an unrelated todo list. Building a real task lifecycle
here — if and when PROJEXA needs one independent of VERIDIAN's — should start from
`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`'s already-honest gap list rather than
re-deriving it, but that is future work, not something this bootstrap fabricates as
already done.

---

## 3. Relationship to `compliance-tracker`'s constitutional documents

This document is PROJEXA's, not a fork of VERIDIAN's. It does not supersede or modify
`compliance-tracker/VERIDIAN_AI_CONSTITUTION.md`,
`compliance-tracker/MASTER_AI_OS_ARCHITECTURE.md`, or
`compliance-tracker/VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` — those govern VERIDIAN's
own repository and continue to apply there unchanged. Where PROJEXA's behavior depends
on VERIDIAN (i.e., all of it, per §1), the correct fix for a governance gap is usually
on VERIDIAN's side of the API boundary, named as a follow-up here rather than
duplicated into this repo's code.

## 4. What this bootstrap did and did not do

**Did**: added this document and `AGENTS.md` at the repo root. Zero application code,
schema, or migration files touched.

**Did not**: implement any guardrail, add CI, configure branch protection, or wire
per-organization VERIDIAN credentials. Those are named as real, open gaps above —
follow-up work, not silently deferred.
