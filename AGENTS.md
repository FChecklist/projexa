# AGENTS.md — Authorized AI Agents (PROJEXA)

> Owner: Rajat Agarwal (raajat.agarwal@gmail.com)

This document is the PROJEXA-specific counterpart to `FChecklist/compliance-tracker`'s
`AGENTS.md`. It is written from scratch for this repository, not copied — PROJEXA's
own history and infrastructure are different from VERIDIAN's, and this file says so
honestly rather than asserting a governance setup that doesn't exist here yet.

## What this repo actually is (as of 2026-07-11)

PROJEXA is a construction/architecture/interior-design project-management product:
Next.js 16 (App Router) + TypeScript (strict) + Tailwind 4 + Drizzle ORM (`postgres.js`)
against Supabase Postgres, `bun` as the package manager (`bun.lock`). It carries **no
construction domain data of its own** — schedule, BOQ, RFIs, punch lists, mood boards,
FF&E, floor plans, etc. are all read/written through a single proxy client,
`src/lib/veridian-client.ts`, which calls VERIDIAN's `/api/v1/projexa/*` API surface
with a Bearer API key. PROJEXA's own Drizzle schema (`src/lib/db/schema.ts`) holds only
tenant/auth plumbing (`organizations`, `memberships`) and PROJEXA's own
chat/todo/assistant-history tables (`assistant_queries`, `conversations`,
`conversation_participants`, `messages`, `todos`).

## Evidence of how this repo has been built so far

**[FACT, verified via `git log`]** — every commit on `main` (9 total, `318a036` through
`b7888af`, all dated 2026-07-08/09) is authored by the single account
`FChecklist <49814285+FChecklist@users.noreply.github.com>`. There is no second author,
no human co-author trailer, and no evidence in the commit history itself of a
doer/auditor split the way `compliance-tracker`'s Z.ai-GLM/Claude-Code two-agent setup
works. Several commit messages ("Add Wave 3 interior design workflow...", "Add Wave 4
visual design authoring...") use the same "Wave N" convention `compliance-tracker` uses
for AI-agent-driven work, which is suggestive of AI-agent authorship, but **this repo
has no `repository_dispatch` workflow, no `ai-team-workforce.yml`-equivalent, and no
`ai-os/` directory** — so, unlike `compliance-tracker`, there is currently no
mechanically-triggered multi-agent dispatch infrastructure here to point to. Treat any
claim that PROJEXA has "the same dual-agent setup as compliance-tracker" as false until
that infrastructure is actually built here.

**[NOT APPLICABLE YET]** — a named, per-repo "Authorized Agents" roster (the kind
`compliance-tracker/AGENTS.md` has, with named triggers, API keys, and permissions) does
not exist for PROJEXA yet, because no dispatch mechanism exists to authorize agents
*into*. This document establishes the governance discipline (Operating Rules below) so
that whenever such infrastructure is added, it has rules to be built under from day
one — not so it can claim the roster already exists.

## Operating Rules

1. **Owner sign-off required to weaken any rule below.** Any change that removes,
   disables, or routes around a rule in this file requires Rajat Agarwal's explicit
   written instruction, quoted in the PR description — the same anti-bypass principle
   as `compliance-tracker/AGENTS.md` Operating Rule 9. Extending or tightening a rule
   never requires this.

2. **Branch protection / PR requirement — [POLICY ONLY, not yet configured].**
   `main` currently has no GitHub branch-protection rule confirmed configured on
   the GitHub side (not checked via the GitHub API's branch-protection endpoint by
   this bootstrap; it should be verified and enabled separately). This repo also has
   **no `.github/workflows/` directory at all** — zero CI jobs exist to gate a PR on.
   Practice going forward: work on a branch, open a PR against `main`, and do not
   merge without CI once CI exists. Until CI exists, a PR against `main` is still the
   required review surface, but nothing currently blocks a direct push except human
   discipline — stated honestly, not glossed over the way a fabricated "CI-gated"
   claim would.

3. **Doer + auditor discipline for future multi-agent work.** If and when a second
   agent (or a second AI system) is authorized to write code in this repo, the agent
   that did **not** build a change is the mandatory auditor for it before merge —
   adopted from `compliance-tracker/AGENTS.md` Operating Rule 7(c). Not yet
   operative today because only a single authoring identity has ever committed here
   (see "Evidence" above) — recorded here so it applies automatically the moment a
   second agent starts contributing, rather than needing to be invented after the
   fact.

4. **No fabricated governance.** Do not add "Authorized Agents" entries, CI job
   names, or enforcement claims to this file that don't correspond to something real
   in this repository. If a rule is aspirational, mark it `[POLICY ONLY]` or
   `[NOT APPLICABLE YET]` per the same discipline `compliance-tracker`'s constitutional
   documents use (see `PROJEXA_TASK_GOVERNANCE.md` in this repo).

5. **Do not commit secrets.** `.env.local` (Supabase URL/anon key, `VERIDIAN_API_KEY`,
   `VERIDIAN_API_BASE_URL`) must never be committed — already gitignored; keep it that
   way.

6. **AI-facing capability lives in VERIDIAN, not here.** PROJEXA has no local LLM
   client, no API key for any model provider, and no prompt-construction code of its
   own (verified by repo-wide search — see `PROJEXA_TASK_GOVERNANCE.md` §1). Any
   change that adds a direct model-provider call to this repo (OpenAI/Anthropic/
   OpenRouter/Groq SDK, a raw `fetch` to a `/chat/completions`-shaped endpoint, etc.)
   is an architecture change, not a routine feature — flag it for owner review rather
   than merging it as a normal PR, since it would bypass VERIDIAN's own AI governance
   (`VERIDIAN_AI_CONSTITUTION.md`, `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`) entirely.

## Contact

Repository owner: raajat.agarwal@gmail.com
