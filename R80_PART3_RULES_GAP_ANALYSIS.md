# R80 PART 3 — RULES.txt Gap Analysis vs. the Actual System

**Date:** 2026-09-08
**Document under test:** `C:\Users\Dell\Desktop\RULES.txt`
**Method:** Every verdict below rests on evidence gathered live in this session — a file opened at a
named line, a SQL result from Supabase MCP, or real `git`/`gh`/network output. No prior session's
notes, memory files, or claims were used as evidence. The document's own `STATUS=YES /
VERIFICATION=Validated` column is the **claim under test**, never evidence for itself.

---

## 0. FIRST CORRECTION: the document has 128 rows, not 130

The table's numbering runs 1→130 but **rows #7 and #9 do not exist** (`RULES.txt` line 8 is `#6`,
line 9 is `#8`, line 10 is `#10`). Data rows occupy lines 3–130 = **128 rows**. All 128 claim
`YES / Validated`.

---

## (a) SUMMARY COUNTS

| Verdict | Count | % of 128 |
|---|---|---|
| **TRUE** | 1 | 0.8% |
| **FALSE** | 90 | 70.3% |
| **PARTIAL** | 14 | 10.9% |
| **NOT-APPLICABLE** | 5 | 3.9% |
| **UNEVIDENCEABLE** | 18 | 14.1% |
| **TOTAL** | **128** | 100% |

---

## 0.1 THE FIVE MASTER FINDINGS (each drives dozens of rows)

**F1 — The SERVER does not exist as a usable machine.**
The only server identity in the whole system is IP `167.233.220.35`
(`C:\Users\Dell\.claude\hooks\veridian-server-gate.py:6`, `SERVER_MARKER = "167.233.220.35"`;
`C:\Users\Dell\.ssh\known_hosts` lines 1–3). Live probes this session:
- `Test-NetConnection 167.233.220.35 -Port 22` → `TcpTestSucceeded=False`
- 3 consecutive `ssh -i ~/.ssh/veridian-dev root@167.233.220.35` attempts (8s connect timeout) →
  `connect to host 167.233.220.35 port 22: Connection timed out` **3 times out of 3**
- Control probe in the same run: `Test-NetConnection github.com -Port 443` → `True`, so the
  laptop's network is fine.
- The gate hook's whitelisted dispatch wrapper `dispatch-owner-task.sh` **does not exist anywhere**
  on disk (recursive search of `C:\ct\ct`, `C:\ct\projexa`, `C:\Users\Dell\.claude` → 0 hits).
- `C:\Users\Dell\.claude\sentinel\` last modified **2026-08-01** — 38 days stale.
- All CI runs GitHub-hosted: `C:\ct\projexa\.github\workflows\*.yml` → `runs-on: ubuntu-latest` ×10,
  zero self-hosted runners.
- All recent commits are authored locally: `git -C C:\ct\projexa log -10` shows 10 commits
  2026-09-07/08 authored `FChecklist`, culminating in `b5c347b`.

**Consequence:** every rule predicated on "SERVER" (4, 22–25, 31–34, 52, 55, 57, 60, 71–76, 81,
86–93, 95, 96, 98, 101, 104, 114, 124) describes infrastructure that is not there.

**F2 — `PROJECT_MANAGER_SERVER` and `PROJECT_MANAGER_DESKTOP` exist nowhere.**
`git -C C:\ct\projexa grep -niI "PROJECT_MANAGER"` → **exit 1, zero matches**.
`git -C C:\ct\ct grep -niI "PROJECT_MANAGER"` → 3 matches, all the unrelated lowercase product role
`project_manager` in `C:\ct\ct\src\lib\ai-team\roster.ts:179` and
`C:\ct\ct\ai-os\AI_ROSTER_CATALOG.json:268`. Neither uppercase identifier appears in either repo,
in `C:\Users\Dell\.claude\settings.json`, or in any config file. **The two central actors of the
entire document are undefined everywhere in the system.**

**F3 — Non-Claude models and OpenRouter are in active, committed use.**
`C:\ct\ct\src\lib\ai-team\roster.ts:7-8` — "Every model here is called via OpenRouter
(`process.env.OPENROUTER_API_KEY`)". Model constants at lines 131–158:
`GLM_52 = "z-ai/glm-5.2"` (line 131), `GLM_5V_TURBO = "z-ai/glm-5v-turbo"` (132),
`GLM_5_TURBO = "z-ai/glm-5-turbo"` (133), `DEEPSEEK_V4_PRO = "deepseek/deepseek-v4-pro"` (150),
plus Gemini 2.5 Pro, GPT-5.5 and `openai/gpt-oss-120b` (lines 27–30, 156–158). This flatly
contradicts rules 6, 36, 37, 38.

**F4 — Worker parallelism and worker model are both violated, and nothing could enforce either.**
`C:\ct\projexa\CLAUDE.md:333`, committed as `b5c347b` (2026-09-08, "R80: rewrite 22 stale E2E
specs…"), states in the repo's own words: *"The rewrite was done by 24 parallel agents reading real
source rather than a live browser."* That is **24 parallel workers against a cap of 5** (rules
39, 82).
Model evidence from this session's own transcript
`C:\Users\Dell\.claude\projects\C--Users-Dell-Downloads-Claude-Code\b63fe1dc-….jsonl`:
`"model":"claude-sonnet-5"` ×9166, `"model":"claude-opus-5"` ×93, `"model":"opus"` ×4,
**`claude-haiku` as a model value: 0**. Workers inherit the session model; rule 123 (workers on
Haiku 4.5) is violated, and rules 121/122 (PMs on Sonnet 5.0 High) are violated by the Opus-5 usage.
**Enforceability:** there is no `.claude/agents/` directory at user, `ct`, or `projexa` level; no
`settings.local.json` anywhere; no project `.claude/settings.json`. The only settings file,
`C:\Users\Dell\.claude\settings.json`, contains **only** `hooks`, `theme`, `skipWorkflowUsageWarning`
and `mcpServers` — **no model pin, no agent cap, no worker registry**. No CI workflow pins a model
either. Nothing in the system can enforce rules 39, 82 or 123.

**F5 — There is no Master Issue Tracker, no phase register, and no worker-execution record.**
Supabase `pcrjmlpuqsbocqfwoxod` (verdian-ai) and `evpckeuxgvahguwsaeul` (projexa) were both
enumerated via `information_schema.tables`:
- projexa DB: **zero** tables matching `%worker%|%agent%|%tracker%|%phase%|%rule%|%r80%|%claude%`.
- verdian-ai DB: no `%r80%`, `%tracker%`, `%certif%`, `%master%`, `%cron%` or `%parallel%` table.
- `platform.task_register` → **0 rows**. `platform.r74_agent_register` → **0 rows**.
  `platform.dispatch_outcomes` → **0 rows**. `platform.worker_agent_usage_log` → **0 rows**.
- The closest thing, `platform.ops_dev_tasks` (2214 rows), is **not boolean** — 11 distinct statuses
  (`blocked` 1323, `completed` 592, `failed` 84, `superseded` 80, `pending_review` 43,
  `in_progress` 31, `completed_docs_only` 26, `completed_no_change` 10,
  `awaiting_human_approval` 9, `rejected_duplicate` 8, `cancelled` 8) — and **stale**: newest
  `last_synced_at` = 2026-08-18, 21 days ago. 60% of its rows are `blocked`.
- GitHub Issues is not it either: `gh issue list -R FChecklist/projexa --state open` → `[]`.

---

## (b) POINTWISE TABLE — all 128 rules

Near-duplicate rules are grouped in the Evidence column rather than re-argued
(explicit duplicate pairs: **39≡82**, **41≡51**, **11/42**, **56/57**, **13/15/40/61-63/80/118-120/127**,
**35/111**, **110/112**, **91/113/114**, **50/65/97**, **71-75**, **86-90**).

| # | Verdict | Evidence |
|---|---|---|
| 1 | UNEVIDENCEABLE | "Priority" is a stated intent. No artifact in the system records a priority ordering; nothing could prove or disprove it. |
| 2 | FALSE | Requires a token→outcome ledger. `compliance.token_usage_ledger` = **14 rows, newest 2026-08-07** (32 days stale) and is the product's customer-facing ledger, not governance. No per-task justification record exists. |
| 3 | UNEVIDENCEABLE | No per-action token accounting exists anywhere; "wasted" is unmeasurable in this system. |
| 4 | FALSE | F1 + F2: no server reachable (3/3 SSH timeouts), identifier absent from both repos. |
| 5 | FALSE | F2: `git grep PROJECT_MANAGER` → exit 1 in projexa; 0 uppercase matches in ct. Never defined. |
| 6 | FALSE | F3: `roster.ts:7-8` OpenRouter; GLM-5.2/5V/5-Turbo, DeepSeek V4 Pro, Gemini, GPT-5.5 at lines 131–158. |
| 8 | FALSE | F5: no tracker table in either DB; `task_register` 0 rows; `gh issue list` → `[]`. |
| 10 | FALSE | F5: `ops_dev_tasks` uses 11 non-boolean statuses. No boolean closure field exists. |
| 11 | FALSE | Duplication demonstrably occurred: `ops_dev_tasks.status='rejected_duplicate'` = **8 rows**. No dedup enforcement mechanism found. |
| 12 | FALSE | `ops_dev_tasks`: 1323 `blocked` + 84 `failed` = 1407 of 2214 rows (63.6%) are unclosed gaps. |
| 13 | FALSE | This very task (an open-ended gap analysis producing prose) is the counter-example, and it is the work actually being done. |
| 14 | UNEVIDENCEABLE | "Noise/repetition" is subjective; no artifact measures it. (Noted: the document itself repeats ~8 ideas across ~40 rows.) |
| 15 | FALSE | Duplicate of 13. Same evidence. |
| 16 | FALSE | No register of 500 points exists. `git grep -E "500 points\|500 individual"` across both repos → only one unrelated hit (a 1,500-request API load test, `ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_…_2026-08-03.md:305`). |
| 17 | UNEVIDENCEABLE | A design philosophy; no artifact could confirm ordering of "software first, AI second". |
| 18 | UNEVIDENCEABLE | See 2/3: no governance token accounting exists to optimise against. |
| 19 | UNEVIDENCEABLE | No measurement of reuse-vs-rebuild exists. |
| 20 | N-A | A statement about the document's own force, not a property of the system. |
| 21 | FALSE | F2. Identical to 5. |
| 22 | FALSE | F1/F2: the entity holding this role does not exist. |
| 23 | FALSE | F1: server unreachable; all 10 latest commits authored on the laptop; CI on `ubuntu-latest`. |
| 24 | FALSE | F2: no such controller exists in code or config. |
| 25 | FALSE | F2: no entity, therefore no responsibility assignment. |
| 26 | FALSE | F2: `PROJECT_MANAGER_DESKTOP` — 0 occurrences system-wide. |
| 27 | FALSE | The laptop performs *all* execution (F1), which is the opposite of a thin client. |
| 28 | PARTIAL | The factual location of all work **is** the owner's laptop (`C:\ct\projexa`, `C:\ct\ct`, local commits) — but no entity named `PROJECT_MANAGER_DESKTOP` exists to have that location. |
| 29 | N-A | There is no server to overrule (F1). |
| 30 | FALSE | The laptop's actual responsibility set is everything, not the three listed items. |
| 31 | FALSE | **Decisive:** commits `b5c347b`…`236fe54` all local; CI `ubuntu-latest`; server TCP/22 dead 3/3. Zero work happens on a server. |
| 32 | FALSE | F1/F2. |
| 33 | FALSE | F1/F2. |
| 34 | FALSE | F1/F2. |
| 35 | FALSE | Duplicate of 27/111. |
| 36 | FALSE | F3. |
| 37 | FALSE | F3: `OPENROUTER_API_KEY` is the transport for the entire roster (`roster.ts:8`). No owner-specific authorisation recorded in code. |
| 38 | FALSE | F3: Gemini, GPT-5.5, DeepSeek, GLM all external, all live in `roster.ts`. |
| 39 | FALSE | **F4: 24 parallel agents**, `C:\ct\projexa\CLAUDE.md:333`, commit `b5c347b`. Cap is 5. Nothing can enforce it (no `.claude/agents/`, no settings key). |
| 40 | FALSE | Same as 13/15; the 24 agents performed open-ended source reading and rewriting. |
| 41 | PARTIAL | `platform.worker_agents` (27 rows) genuinely carries `prompt_template`, `input_schema`, `output_schema` — a pre-determined workflow, **but only for the product's own worker-agent catalog**. The Claude Code agents that do the actual R80 work have no such registry. |
| 42 | FALSE | No enforcement artifact; 8 `rejected_duplicate` rows prove duplication reached the tracker. |
| 43 | PARTIAL | One real artifact exists: `C:\ct\ct\ai-os\boss\ACTIVE-CLAIMS.yaml` (691,953 bytes). But it is **advisory, not enforced** (its own header: "NOT A SUBSTITUTE FOR GIT'S OWN SAFETY"), and it is **stale — last modified 2026-09-05**, 3 days before the R80 work of `b5c347b`. |
| 44 | UNEVIDENCEABLE | "Confusion" has no observable representation in any file or table. |
| 45 | UNEVIDENCEABLE | See 2/3/18. |
| 46 | FALSE | No enforcement exists, and manual search is the norm — this analysis itself required repeated `git grep`/`Select-String` sweeps. |
| 47 | FALSE | No mechanism gates independent AI action; `settings.json` has no such hook (only a Bash server-gate and a transcript-push). |
| 48 | PARTIAL | Reuse artifacts do exist (`~/.claude/projects/…` transcripts, memory files, `ACTIVE-CLAIMS.yaml`), but reuse is discretionary and unenforced; the owner explicitly barred memory reuse for this task. |
| 49 | UNEVIDENCEABLE | No metric distinguishes reuse from rebuild. |
| 50 | UNEVIDENCEABLE | No record of what was read vs. re-read exists. |
| 51 | PARTIAL | Duplicate of 41. |
| 52 | FALSE | F2: no assigner exists. |
| 53 | FALSE | `platform.worker_agent_usage_log` = **0 rows**; `dispatch_outcomes` = **0 rows**. No worker has ever recorded a boolean completion. |
| 54 | PARTIAL | Only `ACTIVE-CLAIMS.yaml` addresses this, advisory and stale (see 43). `ct\CLAUDE.md:7` records the origin problem: "4 parallel Claude sessions … with no way to see each other's current work". |
| 55 | FALSE | F2. |
| 56 | PARTIAL | Same artifact/limits as 54. |
| 57 | FALSE | F2. |
| 58 | UNEVIDENCEABLE | No audit-trail field records whether a worker audited a script before use. |
| 59 | UNEVIDENCEABLE | An internal disposition; no artifact could capture it. |
| 60 | FALSE | F2: there is no `PROJECT_MANAGER_SERVER` to report to; agents report to the launching session. |
| 61 | FALSE | Duplicate of 13. |
| 62 | FALSE | Duplicate of 13. |
| 63 | FALSE | Duplicate of 13. |
| 64 | UNEVIDENCEABLE | No per-worker context-provenance record exists. |
| 65 | UNEVIDENCEABLE | Duplicate of 50. |
| 66 | UNEVIDENCEABLE | Duplicate of 3/45. |
| 67 | FALSE | The 24 agents of `b5c347b` "read real source" and rewrote 22 spec files — that is reasoning. Subagents are full LLM sessions; the transcript shows them on `claude-sonnet-5`/`claude-opus-5`, reasoning models. |
| 68 | FALSE | Same evidence as 67 — spec rewriting from source is analysis by definition. |
| 69 | FALSE | Same evidence as 67 — the agents gathered their own context. |
| 70 | UNEVIDENCEABLE | No log distinguishes "assigned" from "self-initiated" agent actions. |
| 71 | FALSE | F2. |
| 72 | FALSE | F2. |
| 73 | FALSE | F2. |
| 74 | FALSE | F2. |
| 75 | FALSE | F2. |
| 76 | FALSE | F2 + no phase artifact (see 77). |
| 77 | FALSE | `git grep -niI "24 phases"` across both repos → **0 hits**. No phase table in either Supabase project. |
| 78 | FALSE | No phase register exists to carry a duration; `git grep "60-minute\|60 minute"` → 0 relevant hits. |
| 79 | FALSE | No phases exist to contain tasks. |
| 80 | FALSE | Duplicate of 13; and `ops_dev_tasks` statuses are non-boolean. |
| 81 | FALSE | F2. |
| 82 | FALSE | **Duplicate of 39** — same 24-agent violation, `CLAUDE.md:333` / `b5c347b`. |
| 83 | PARTIAL | `worker_agents.input_schema` (jsonb) exists for the 27 product agents only; Claude Code task assignments have no schema'd input. |
| 84 | PARTIAL | `worker_agents.output_schema` (jsonb), same limitation as 83. |
| 85 | PARTIAL | `worker_agents.prompt_template`, same limitation as 83. |
| 86 | FALSE | F2. |
| 87 | FALSE | F2. |
| 88 | FALSE | F2. |
| 89 | FALSE | F2. |
| 90 | FALSE | F2. |
| 91 | FALSE | The one sync mechanism, `~/.claude/hooks/push-transcript-to-veridian.sh`, pipes to `ssh … rajat@167.233.220.35` — a host that times out 3/3. Its own state dir `~/.claude/veridian-transcript-state\` holds **2 files, last written 2026-07-23** — the hook has failed silently for ~7 weeks (it is written to "fail silently and never block"). |
| 92 | FALSE | Same evidence as 91: the last successful sync was 2026-07-23. |
| 93 | FALSE | F2; no version register exists. |
| 94 | UNEVIDENCEABLE | A causal assertion about a mechanism that does not exist; untestable. |
| 95 | FALSE | F2. |
| 96 | FALSE | F2. |
| 97 | UNEVIDENCEABLE | Duplicate of 50/65. |
| 98 | FALSE | F2; no certification table or file in either DB (`%certif%` → only `compliance.access_review_certifications`, an unrelated product table). |
| 99 | FALSE | No validation record exists to be 100% of anything. |
| 100 | FALSE | `ops_dev_tasks`' 11 statuses are the only closure vocabulary in the system, and it is not boolean. |
| 101 | FALSE | Sync dead since 2026-07-23 (see 91). |
| 102 | FALSE | The laptop executes *everything*, not "local tasks only". |
| 103 | PARTIAL | The owner does drive the work, but the "only if asked" qualifier is meaningless because there is no alternative server path — local is the default, contradicting rule 104. |
| 104 | FALSE | Direct contradiction of observed reality: default and only execution venue is the laptop (F1). |
| 105 | N-A | No server exists to override. |
| 106 | FALSE | **`list_scheduled_tasks` returns exactly one task**: `reset-supabase-access-token`, `"schedule": "One-time: 12/8/2026"`, `"enabled": false`, `lastRunAt 2026-08-12`. **No 60-minute cron exists.** (6 further SKILL.md dirs sit unregistered under `~/.claude/scheduled-tasks\`, including `veridian-server-sentinel` — orphaned, never scheduled.) |
| 107 | FALSE | No cron exists to review anything (see 106). |
| 108 | PARTIAL | Review does happen — this document is one — but ad-hoc and owner-triggered, with no scheduled or recorded review mechanism. |
| 109 | FALSE | No rule-enforcement artifact exists; this analysis is the first check of RULES.txt against reality, and it found 90 failures. |
| 110 | FALSE | Inverted in practice: the laptop does all the work that the document assigns to the server. |
| 111 | FALSE | Duplicate of 27/35. |
| 112 | FALSE | Duplicate of 110. |
| 113 | FALSE | Duplicate of 91/92 — sync dead since 2026-07-23. |
| 114 | FALSE | Duplicate of 91. |
| 115 | FALSE | Only ONE direction was ever built (desktop→server transcript push), and it is dead. No server→desktop channel exists in any script or config. |
| 116 | N-A | No server (F1). |
| 117 | N-A | No override mechanism exists to be scoped. |
| 118 | FALSE | Duplicate of 13. |
| 119 | FALSE | Duplicate of 13. |
| 120 | FALSE | Duplicate of 13; no boolean closure field anywhere. |
| 121 | FALSE | No `PROJECT_MANAGER_SERVER` exists (F2); and no model pin exists in `settings.json` or CI. |
| 122 | FALSE | No `PROJECT_MANAGER_DESKTOP` exists; and the live session runs **`claude-opus-5`** (93 + 4 transcript occurrences), not "Sonnet 5.0 High". Nothing pins the model. |
| 123 | FALSE | **`claude-haiku` appears 0 times as a model value** in this session's transcript; agents ran `claude-sonnet-5` (9166) / `claude-opus-5` (93). Subagents inherit the session model; no config could override it. |
| 124 | FALSE | F2. |
| 125 | FALSE | Duplicate of 67. |
| 126 | **TRUE** | Workers do implement. Commit `b5c347b` (2026-09-08) is agent-produced implementation: 22 E2E specs rewritten, 3 product bugs fixed — the one rule the system genuinely satisfies. |
| 127 | FALSE | Duplicate of 13/40; the R80 agent tasks were open-ended ("rewrite specs to match current source"). |
| 128 | FALSE | The tasks actually issued are open-ended by construction (this analysis included). |
| 129 | PARTIAL | Agents do receive structured prompts, but there is no stored, inspectable instruction record — nothing persists an agent's instruction set for audit. |
| 130 | PARTIAL | Claude Code assigns runtime agent IDs, and `platform.worker_agents.id` exists for the 27 product agents — but **no `PROJECT_MANAGER_SERVER` assigns them**, and no R80 worker-ID register was ever written (`r74_agent_register` = 0 rows, `worker_agent_usage_log` = 0 rows). |

---

## (c) GAPS

**GAP-1 — The entire server tier is fictional. (Rules 4, 22–25, 31–34, 52, 55, 57, 60, 71–76, 81, 86–93, 95, 96, 98, 101, 104, 114, 124 — 33 rules)**
`167.233.220.35` refuses TCP/22 on 3/3 attempts; `dispatch-owner-task.sh` is absent; the sentinel is
38 days stale; CI is entirely GitHub-hosted. One-third of the document governs a machine that is not
there. *To implement:* a real host plus an execution agent would have to exist and be registered —
minimally a `PROJECT_MANAGER_SERVER` service definition and a reachable host recorded in
`C:\Users\Dell\.claude\settings.json` and `C:\Users\Dell\.ssh\config` (the latter file does not
currently exist at all). *Alternative, and the honest one:* rewrite these 33 rules for a
laptop-only topology.

**GAP-2 — Both governing entities are undefined. (Rules 5, 21, 26, and every rule naming them)**
`PROJECT_MANAGER_SERVER` / `PROJECT_MANAGER_DESKTOP`: zero occurrences in `C:\ct\projexa` (git grep
exit 1), zero in `C:\ct\ct`, zero in `~/.claude/`. The document's two protagonists have no
definition, no config entry, and no code. *Would have to live in:*
`C:\Users\Dell\.claude\settings.json` (or a new `C:\ct\projexa\.claude\settings.json`) as named
agent definitions, plus a `platform.pm_registry` table in `pcrjmlpuqsbocqfwoxod`.

**GAP-3 — No cap on parallel workers and no worker model pin — both already violated.
(Rules 39, 82, 123, and 121/122)**
`C:\ct\projexa\CLAUDE.md:333` (commit `b5c347b`) records **24 parallel agents** against a stated
maximum of 5. The transcript records **0 Haiku** worker invocations against a mandate that all
workers be Haiku 4.5, and **`claude-opus-5` ×97** against a PM mandate of Sonnet 5.0 High. Critically,
**no configuration in this system is capable of enforcing any of the three**: no `.claude/agents/`
directory exists at any level, no `settings.local.json` exists, no project-level settings file
exists, and `~/.claude/settings.json` contains no model or concurrency key. *Would have to live in:*
`C:\ct\projexa\.claude\settings.json` (agent/model definitions) and a `PreToolUse` hook on the Agent
tool in `~/.claude/settings.json` counting concurrent dispatches — neither exists today.

**GAP-4 — No Master Issue Tracker, no boolean closure, no 500-point register, no 24-phase register.
(Rules 8, 10, 16, 53, 77, 78, 79, 98, 99, 100, 120)**
Verified absent by `information_schema` enumeration of both Supabase projects and by `gh issue list`
(→ `[]`). The nearest candidate, `platform.ops_dev_tasks`, is stale (newest `last_synced_at`
2026-08-18), 63.6% unclosed, and uses 11 non-boolean statuses. `platform.task_register`,
`platform.r74_agent_register`, `platform.dispatch_outcomes` and `platform.worker_agent_usage_log`
are **all 0 rows** — meaning no worker execution has ever been recorded anywhere. *Would have to
live in:* new tables in `pcrjmlpuqsbocqfwoxod` — `platform.r80_issue_tracker`
(point_id, rule_ref, `closed boolean NOT NULL`, evidence_uri), `platform.r80_phases`
(phase_no 1–24, duration_minutes, started_at, ended_at), and `platform.r80_worker_runs`
(worker_id, phase_no, task_id, model, `result boolean`).

**GAP-5 — The desktop↔server sync is one-directional by design and has been dead for ~7 weeks.
(Rules 91, 92, 101, 113, 114, 115)**
`~/.claude/hooks/push-transcript-to-veridian.sh` pipes transcripts to `ssh … rajat@167.233.220.35`
and, by its own comment, "fails silently and never blocks". Its state directory holds **2 files last
written 2026-07-23**, so every Stop event since has failed unnoticed. No server→desktop return
channel was ever written, so rule 115 ("bi-directional") was never true even when the host was up.
*Would have to live in:* a working host plus a return-path hook; today the failure is invisible
because the hook swallows its own errors into
`~/.claude/veridian-transcript-state\<session>.errlog`.

**GAP-6 — 18 rules are structurally unverifiable. (Rules 1, 3, 14, 17, 18, 19, 44, 45, 49, 50, 58, 59, 64, 65, 66, 70, 94, 97)**
These assert internal dispositions or unmeasured qualities — "zero confusion", "worker must not
waste tokens", "do not re-read everything", "each token justified". No artifact in this system
could ever confirm or refute them, yet all 18 are marked `Validated`. This is a legitimate finding,
not a measurement failure: **14% of the ruleset is written so that compliance can never be
demonstrated.** Making them evidenceable would require per-action token accounting and a provenance
log that does not exist (`compliance.token_usage_ledger` is 14 stale product rows).

**GAP-7 — Collision control is advisory and stale. (Rules 43, 54, 56)**
`C:\ct\ct\ai-os\boss\ACTIVE-CLAIMS.yaml` is the only anti-collision artifact. It is 691,953 bytes,
**last modified 2026-09-05** — three days before the 24-agent R80 run — and its own header disclaims
enforcement. `ct\CLAUDE.md:7` documents the unsolved condition: 4 parallel sessions "with no way to
see each other's current work". `ops_dev_tasks` carries 8 `rejected_duplicate` rows, i.e. collisions
reached the tracker.

**GAP-8 — Banned models are in committed production code. (Rules 6, 36, 37, 38)**
`C:\ct\ct\src\lib\ai-team\roster.ts` routes the platform's entire 27-role internal AI workforce
through OpenRouter (`OPENROUTER_API_KEY`, line 8) across GLM-5.2 (131), GLM-5V-Turbo (132),
GLM-5-Turbo (133), DeepSeek-V4-Pro (150), Gemini 2.5 Pro, GPT-5.5 and gpt-oss-120b. Four rules
forbid exactly this. *Would have to live in:* either a removal/gating of `roster.ts`'s model
constants, or an owner exception recorded against rule 37.

**GAP-9 — No 60-minute review cron. (Rules 106, 107, 108, 109)**
`list_scheduled_tasks` returns exactly one entry: `reset-supabase-access-token`, one-time,
`enabled: false`, expired 2026-08-12. Six further SKILL.md directories under
`~/.claude/scheduled-tasks\` (including `veridian-server-sentinel`, 11,667 bytes) are unregistered
orphans. *Would have to live in:* a registered recurring scheduled task with
`cronExpression` on an hourly interval.

---

## (d) DOCUMENT ACCURACY

All 128 rows of `RULES.txt` assert `STATUS = YES` and `VERIFICATION = Validated`. Measured against
the live system:

- **90 of 128 rows (70.3%) are directly contradicted** by evidence gathered in this session.
- **14 rows (10.9%) are overstated** — a partial mechanism exists, but not the one the rule claims,
  or it is stale/advisory/unenforced.
- **18 rows (14.1%) claim "Validated" for propositions that cannot be validated** by any artifact
  this system contains or could produce as built.
- **5 rows (3.9%) are moot**, because they govern interactions with a server that does not exist.
- **1 row (0.8%) — rule 126, "AI WORKER TO IMPLEMENT" — is the only rule that stands as claimed.**

Combining the first three categories: **122 of 128 rows (95.3%) carry a `Validated` mark that the
evidence does not support.** Taking only the strictest reading — rows contradicted by direct
observation — the figure is **90 of 128 (70.3%)**.

Two further defects in the document itself:
1. It is a **128-row table presenting itself as 130 rows**; `#7` and `#9` are absent with no note.
2. The `VERIFICATION` column records the single value `Validated` (once `Validated - Target set`,
   row 16) for every row, with **no verification method, date, evidence reference, or verifier
   named anywhere**. There is no artifact in either repo or either database that any of these 128
   "Validated" marks could have been derived from — no validation run, no certification table, no
   report. The column asserts verification without recording any.
