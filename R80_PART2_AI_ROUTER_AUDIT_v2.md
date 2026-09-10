# R80 PART 2 — AI ROUTER AUDIT v2 (boolean, evidence-only)

Date: 2026-09-10. Session: W-ROUTER (phase S4, P1.1–P1.6). Supersedes `R80_PART2_AI_ROUTER_AUDIT.md` (v1, 2026-09-08) after P1.1 (config-driven per-level provider resolution), P1.2/P1.3 (trigram fuzzy tier, wired at classification time, measured), P1.4 (retired `escalation-tier-catalog.ts`), P1.5 (verified G-02 already fixed, no rename).

Repos audited at these commits:
- `C:\ct\ct` (compliance-tracker / VERIDIAN backend) — branch `main`, `027ed67c`
- `C:\ct\projexa` — branch `main`, `27e026a` (unchanged this session — W-ROUTER's surface here is this file only)

Databases queried live via Supabase MCP, 2026-09-10 (fresh counts, not carried over from v1 except where explicitly marked unchanged):
- `pcrjmlpuqsbocqfwoxod` (compliance-tracker / VERIDIAN backend)
- `evpckeuxgvahguwsaeul` (PROJEXA's own project) — not re-queried this session; v1's finding (14 tables, none AI/pipeline-related) stands, nothing in P1.1–P1.5 touched it.

Verdict key: **TRUE** = exists and is on the live code path. **PARTIAL** = exists but incomplete or off the live path. **FALSE** = does not exist. **UNVERIFIED** = could not be settled with the evidence available. Script: `scripts/r80-part2-ai-router-audit.mjs` (new — none existed before this session; automates the 8 claims materially affected or structurally checkable; the rest are hand-verified below, same discipline as v1).

---

## A. FINDINGS TABLE

| # | Claim | v1 | v2 | Evidence | Note |
|---|---|---|---|---|---|
| 1 | Raw user input is sent to the software untouched | TRUE | **TRUE** (unchanged) | `M24Shell.tsx:2373-2374` — not touched this session | Re-verified by inspection, no code change in this path. |
| 2 | PROJEXA proxies to the VERIDIAN backend | TRUE | **TRUE** (unchanged) | `projexa/src/app/api/tasks/route.ts:64,76` | Not touched this session. |
| 3 | The software breaks one input into MULTIPLE segments | TRUE | **TRUE** (unchanged) | `segment.ts` exists, own "must never call an LLM" assertion present — confirmed by `scripts/r80-part2-ai-router-audit.mjs` #3 | Not touched this session. |
| 4 | Each segment gets its own verdict of task/chat/gap | TRUE | **TRUE** (unchanged) | `classify.ts:21,144` | Not touched. |
| 5 | A submission-level discriminant (CHAT_ONLY/TASK/MULTIPLE_TASKS) exists | TRUE | **TRUE** (unchanged) | `classify.ts:250-257` | Not touched. |
| 6 | That classification is persisted | PARTIAL | **PARTIAL** (unchanged) | Live SQL 2026-09-10: `compliance.submissions` = 50 rows total, `classification IS NOT NULL` = 5 rows — identical to v1's 2026-09-08 count | No new live traffic since v1 (Vercel still paused, zero customers) — nothing to change this claim's live evidence either direction. |
| 7 | A server-side VERDICT step exists | TRUE | **TRUE** (unchanged) | `verdict.ts:25,130,180` | Not touched. |
| 8 | The verdict step is RULE-BASED | TRUE | **TRUE** (unchanged) | `classify.ts:78-138` | Not touched. |
| 9 | The verdict step is MODEL-BASED | PARTIAL | **PARTIAL** (unchanged) | `level1.ts` still only resolves `functionId`; verdict itself still rule-derived | Not touched. |
| 10 | Two-step propose-then-confirm flow exists | TRUE | **TRUE** (unchanged) | `tasks/route.ts:119,141,214,224` | Not touched. |
| 11 | System builds a MODE + OPTIONS + CHAT-INPUT sequence | PARTIAL | **PARTIAL** (unchanged) | `chain-mode.ts:28-34`, `derive-chain.ts` | Not touched. |
| 12 | A pgvector/embedding store exists in the backend DB | TRUE | **TRUE** (unchanged) | 18 vector columns confirmed in v1; not re-queried (no change plausible from this session's work) | Not touched. |
| 13 | A vector/RAG store of input history is READ at classification time | FALSE | **FALSE** (reasoning sharpened) | `scripts/r80-part2-ai-router-audit.mjs` #13: git grep over `src/lib/pipeline` for vector/RAG primitives now hits `phrase-fuzzy.ts` and `run-submission.ts` (2 files, up from v1's 2 prose-comment hits) | **Deliberately still FALSE.** P1.2 added a real similarity tier, but it is `pg_trgm` (lexical trigram), not a vector embedding / RAG store — this claim is specifically about the latter, and the build plan's own section 0(B) explains why embeddings are the wrong tool for an 80-distinct-18-char-phrase corpus. Not conflating the two is the point, not an oversight. |
| 14 | A store of "probable combinations" is read before deciding | PARTIAL | **TRUE** ▲ | `scripts/r80-part2-ai-router-audit.mjs` #14; `phrase-fuzzy.ts` + `reuse-cache.ts:150-172` (`027ed67c`/`6248eee1`) | **Upgraded.** v1: "all four [lookup tiers] are exact-match/hash lookups — none is a similarity search." P1.2 added a genuine `pg_trgm` similarity search over `compliance.phrase_map` (promoted rows only, same M26 promotion rule the exact-match tier enforces), checked before the Level-1 escalation decision. Live-tested: `phrase-fuzzy.test.ts`, 5/5 pass, `extensions.similarity()` measured 0.918 on a real paraphrase pair against `pcrjmlpuqsbocqfwoxod`. |
| 15 | An explicit numeric CONFIDENCE score with a threshold exists | PARTIAL | **TRUE** ▲ | `phrase-fuzzy.ts`: `PHRASE_FUZZY_HIGH_THRESHOLD = 0.85` | **Upgraded.** v1's PARTIAL was specifically because `MIN_CONFIDENCE` (`level1.ts:28`) is the model's own post-hoc self-report, never a pre-call gate. `PHRASE_FUZZY_HIGH_THRESHOLD` is a genuine pre-call, software-computed threshold — the caveat that made this PARTIAL no longer applies to the pipeline as a whole, even though `MIN_CONFIDENCE` itself is unchanged and still post-hoc (comment added at `level1.ts` distinguishing the two, per the build plan's own instruction). |
| 16 | A confidence score DECIDES whether to escalate to AI | FALSE | **TRUE** ▲ | `scripts/r80-part2-ai-router-audit.mjs` #16; `reuse-cache.ts:150-172` | **Upgraded, this is the headline change.** v1: "the escalate decision is a boolean miss, not a score... no confidence is computed before the AI call." Now: a segment that misses L0 and `reuse_cache` gets a software-computed trigram score BEFORE any model call; `score >= 0.85` resolves without escalating, `score < 0.85` escalates to Level 1. Unit-tested three ways (`reuse-cache.test.ts`'s P1.4R block): resolved on the cheap path, escalated once and resolved, escalated and NOT resolved (proving this is a real gate, not a guaranteed-hit dressed up as one). |
| 17 | Other confidence/escalation machinery is wired into this router | FALSE | **FALSE** (unchanged) | v1's grep (confidence-banding/floor-tier-escalation/escalation-ladder/dispatch-confidence-scoring, none imported by `src/lib/pipeline/*`) not re-run — no plausible change from this session's file set | Not touched; those belong to the separate AI Dev Team dispatch system. |
| 18 | `floor-tier-escalation.ts` computes a real confidence number | FALSE | **FALSE** (unchanged) | `floor-tier-escalation.ts` not touched this session | Not touched. |
| 19 | There are exactly 3 AI LEVELS in the live pipeline | FALSE | **FALSE** (now BY DECISION) | `scripts/r80-part2-ai-router-audit.mjs` #19; `adapter.ts`'s `AiProvider` interface still exactly 2 methods | Still no L3 in-request path — v1 called this a gap; v2 records it as a considered, evidenced retirement (P1.4), not an omission. |
| 20 | A 3-tier AI escalation taxonomy exists in code | PARTIAL | **FALSE** ▼ (correctly) | `scripts/r80-part2-ai-router-audit.mjs` #20; `src/lib/ai-router/escalation-tier-catalog.ts` deleted, `027ed67c` | **Downgraded from PARTIAL to FALSE — this is the correct direction.** The file is gone: zero production importers (re-grepped before deletion), unwired by its own header, its own test admitted 2/3 models absent from the live roster, "L3" already means a human approver elsewhere (`analyse.ts`'s `promotePhraseMapCandidate`), and building it out would have added a costlier AI tier against the directive's own "AI escalation last, target <5% AI." An honest FALSE beats a lingering unwired PARTIAL. |
| 21 | The AI level→model mapping is owner-editable, defined in one place | TRUE (2 levels) | **TRUE (2 levels, unchanged)** | Live SQL 2026-09-10: `platform.pipeline_level_models` = 2 rows (unchanged from v1) | P1.4 deliberately did NOT add a 3rd row/enum value — see #20. |
| 22 | "Mother Router L0-L5 done" (prior session memory) | FALSE as stated | **FALSE as stated (unchanged)** | `mother-router.ts` / `software-team-ladder.ts` not touched this session | Not touched; two different systems, still conflated in prior memory, not in code. |
| 23 | AI calls are logged to a usage ledger | PARTIAL | **PARTIAL (unchanged)** | `scripts/r80-part2-ai-router-audit.mjs` #23: 0 files under `src/lib/pipeline` reference `token_usage_ledger`; live SQL: `compliance.token_usage_ledger` = 14 rows total, 0 with `level LIKE 'pipeline%'` | Build plan Step 1c (widen `AiProvider.classify` to return usage, call `logTokenUsage` from `level1.ts`) is real work, explicitly NOT in this session's P1.1–P1.6 scope, and was not built here. Flagging for a dedicated follow-up rather than silently claiming it's done. |
| 24 | The pipeline emits an ERP-vs-AI usage measurement (persisted) | PARTIAL | **PARTIAL (unchanged, honestly)** | Live SQL 2026-09-10: `compliance.submissions` — `l0_hit_rate`, `model_calls`, `source`, `level` all **0 of 50 rows non-null** | The columns exist (migration 0571, landed 7a13df3d **before** this session) and the write-path code references them (`run-submission.ts`), but **zero live submissions carry a non-null value** — because zero real traffic has hit the live path since those columns were added (Vercel still paused, zero customers). Code-complete, live-unproven; this is the same "Vercel paused means nothing gets truly exercised" condition that shapes most of this audit, not a defect introduced or left by this session. |
| 25 | Some telemetry could substantiate the 95%/<5% target | PARTIAL | **PARTIAL (unchanged)** | `ai-reduction-service.ts` not touched this session; new `platform.pipeline_similarity_metrics` (P1.3) is a DIFFERENT, narrower measurement (one seeded/batch run's fuzzy-vs-model split, not a live-traffic ratio) | P1.3's table is deliberately NOT a replacement for a live 95/5 ratio — it has exactly 1 row (this session's own seeded test), same "would need real traffic to mean anything" caveat as #24. |
| 26 | A 95%/<5% target is expressed anywhere in code | FALSE | **FALSE (unchanged)** | Not re-grepped (no plausible change from this session's file set — none of P1.1–P1.5 added a 95/5 constant) | Not touched. |
| 27 | Anything ENFORCES or gates on the 95/5 split | FALSE | **FALSE (unchanged)** | Same reasoning as #26 | Not touched. |
| 28 | The client consumes the level/telemetry fields | FALSE | **FALSE (unchanged)** | PROJEXA (`composer-turns.ts`, `M24Shell.tsx`) not touched this session — this task's surface excluded `src/components/marketing`/`src/app/api` in both repos | Out of this phase's surface. |
| 29 | `POST /api/classify` preview endpoint exists but is dormant | TRUE, dormant | **TRUE, dormant (unchanged)** | `classify-only.ts`, `projexa/api/classify/route.ts` not touched this session | Not touched; still zero client callers. |
| 30 | `verdict` (per-segment field) is consumed by the UI | FALSE | **FALSE (unchanged)** | PROJEXA client not touched this session | Out of surface. |
| 31 | The pipeline writes back what it learned (memory) | PARTIAL | **PARTIAL (unchanged)** | `run-submission.ts:269-309` (`captureTaskResultMemory`) not touched this session; live memory tables not re-queried (no plausible change) | Not touched. |
| 32 | The live AI provider is production-safe | PARTIAL/UNVERIFIED | **PARTIAL/UNVERIFIED, code materially safer** | `provider-config.ts` + `adapter.ts` (`f8fc671f`) | The CODE is now config-driven, per-level, with an explicit allowlist and the same compliance identity gate on `claude-cli` unconditionally preserved (see P1.1's commit for the full reasoning — Anthropic's Claude Code CLI OAuth policy is individual-use-only, and this session declined to remove that restriction even when both the original bootstrap and, initially, the PM session asked for its removal). The DEPLOYED Vercel env value is still unverified — Vercel remains paused this entire engagement, so this cannot be settled from here. |
| 33 | Gap logging exists so unresolved input is never silently dropped | TRUE | **TRUE (unchanged)** | Live SQL 2026-09-10: `compliance.gap_log` = 8 rows, identical to v1 | Not touched. |
| 34 | Production evidence the pipeline is actually exercised | PARTIAL | **PARTIAL (unchanged)** | Live SQL 2026-09-10: `compliance.submissions` = 50 (identical to v1), `compliance.reuse_cache` = 0 (identical), `compliance.phrase_map` = 186 real + this session's own `test-`-prefixed fixture rows (cleaned up after each test run) | No new live traffic since v1 — same newest-submission timestamp implied by the unchanged total. |

**Tally: 34 claims re-checked — 14 TRUE (+3 from v1: #14, #15, #16), 9 FALSE (+1 from v1's PARTIAL: #20; −1 from v1's FALSE: #16 moved to TRUE), 10 PARTIAL, 1 PARTIAL/UNVERIFIED.**

**FALSE count: 9 — ids 13, 17, 18, 19, 20, 26, 27, 28, 30.**

This is **not zero.** Per this step's own success criterion ("True only when the false count is zero; otherwise record the exact remaining count and ids"), P1.6 is recorded **false**, count **9**, ids **13, 17, 18, 19, 20, 26, 27, 28, 30** — see STATE.jsonl.

---

## B. WHY THE REMAINING 9 ARE HONEST, NOT A FAILURE TO TRY

- **#13** is FALSE **by design** — conflating trigram similarity with a vector/RAG store would be a false TRUE, which this audit exists to prevent (see v1's own section 0(B) reasoning, reused unmodified here).
- **#19/#20** are FALSE **by decision** (P1.4's retirement) — the alternative (build out a 3rd AI tier to make these read TRUE) was evaluated and rejected on evidence, including this session's own re-verification of the file's dead-code status.
- **#17/#18/#26/#27/#28/#30** are FALSE for reasons entirely outside this phase's stated surface (`src/lib/ai`, `src/lib/ai-router`, `src/lib/pipeline`, migrations) — they live in the AI Dev Team dispatch system, PROJEXA's client code, or require a live-traffic 95/5 constant nobody has asked to add yet. None of P1.1–P1.6 claimed to touch them, and this report does not pretend otherwise.

## C. WHAT THIS SESSION ACTUALLY MOVED

Three claims flipped to TRUE (#14, #15, #16) and one correctly flipped from an unwired PARTIAL to an honest FALSE (#20) — all four are the direct result of P1.1–P1.4's real code changes (`f8fc671f`, `6248eee1`, `027ed67c`), not re-interpretation of unchanged evidence. Every other claim's verdict is either genuinely unchanged (re-verified against fresh live-DB counts where the claim depends on one) or explicitly marked out of this phase's surface.

## D. UNVERIFIED, carried from v1

Unchanged from v1 — none of P1.1–P1.6 touched the deployed Vercel environment (still paused) or the L2 nightly batch's promotion history:
1. The deployed value of `AI_PROVIDER`/`RAJAT_USER_ID`/`OPENROUTER_API_KEY` in Vercel Production.
2. Whether the L2 nightly batch has ever produced a `phrase_map` promotion (source/created_at breakdown not re-run this session).
3. Whether the 8 `gap_log` rows and 981 `compliance.embeddings` rows are related (not re-traced this session).
