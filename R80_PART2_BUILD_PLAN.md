# R80 PART 2 — BUILD PLAN: MAKE THE ROUTER MATCH THE DIRECTIVE

Verified against `C:\ct\ct` @ `c8182fe7` (main), `C:\ct\projexa`, and live Supabase `pcrjmlpuqsbocqfwoxod`. Every line number below was re-checked in the working tree, not taken from the maps.

---

## 0. THREE VERIFIED FINDINGS THAT CHANGE YOUR ORDERING

**(A) Gap 4 is ~90% not a gap. Demote it.** I queried the live table rather than trusting the count:

| status | classification | n | first | last |
|---|---|---|---|---|
| failed | **null** | 20 | 2026-08-24 | 2026-08-29 |
| done | **null** | 12 | 2026-08-24 | 2026-08-29 |
| in_progress | **null** | 5 | 2026-08-29 | 2026-09-02 |
| partial | **null** | 5 | 2026-08-24 | 2026-08-26 |
| chat | **null** | 3 | 2026-08-24 | 2026-08-24 |
| failed | TASK | 2 | 2026-09-02 | 2026-09-02 |
| in_progress | TASK | 3 | 2026-09-04 | 2026-09-04 |

The column was created by `drizzle/0525_r65_partd_submission_classification.sql:93-94`.

> **CORRECTED 2026-09-08 — the claim originally made here was WRONG and was used twice before it was checked.**
>
> This paragraph originally read: *"Every one of the 45 NULLs predates that migration."* It does not. Measured against
> `supabase_migrations.schema_migrations`, `0525` was applied at **`20260901205052`** (2026-09-01 20:50:52). Two NULL rows
> are dated **2026-09-02 05:50:11** and **06:11:45** — roughly nine hours AFTER it.
>
> Grouped by era and status, the real position is:
>
> | era | status | classification | rows |
> |---|---|---|---|
> | pre-0525 | all statuses | NULL | 43 |
> | post-0525 | in_progress | **NULL** | **2** |
> | post-0525 | in_progress | set | 3 |
> | post-0525 | failed | set | 2 |
>
> So **2 of 7 post-migration submissions (29%) carry no classification**, and it is NOT status-determined — three other
> `in_progress` rows do carry one. `submitForVerdict()` INSERTs the row, then writes `classification` in a LATER UPDATE
> (`run-submission.ts:1193-1200`); anything throwing between the two strands the row as `in_progress` with NULL. It is a
> failure window, not a missing write.
>
> The audit's original Gap 4 was therefore OVERSTATED but not empty, and this rebuttal was overstated in the other
> direction. Both were wrong; the truth is narrower than either.
>
> **This lands directly on step 1b.** The seven telemetry columns added by migration `0571` are written in THAT SAME
> UPDATE. Every submission that dies between INSERT and UPDATE records no telemetry at all — so an L0-vs-AI ratio computed
> from that table is computed only over submissions that survived long enough to be counted. A silently biased
> denominator, in the measurement built to be trustworthy. On this data that is 2 in 7, and the ones that die are
> disproportionately the interesting ones. The ledger write must not live only in the completion path: something has to
> record "a submission started and never resolved", or the split over-reports software success.

Gap 4 does not collapse. It narrows to: classification (and now telemetry) is lost whenever a submission fails between
INSERT and UPDATE. The decision not to backfill the 43 pre-migration rows stands.

**(B) Item 3 as written ("add a similarity lookup" over embeddings) should not be built. The corpus and the machinery both refuse it.**
- Live corpus: `compliance.phrase_map` = 186 rows but only **80 distinct `normalised_phrase` values across 3 orgs**, mean length **18 chars**, min 4, max 33. Cosine similarity in a 1536-dim space over ~27 four-to-thirty-three-character strings per org is noise, and the repo's own 0.5 relevance floor was tuned for 86–330 char capability descriptions.
- `findSimilar()` (`embeddings.ts:416-439`) returns zero rows for *every* query — the `e.embedding_model = ${model}` clause can never match `unknown-legacy`, and `defaultFindSimilarClient` never sets `app.current_org_id` under FORCE RLS.
- It costs a live network round trip: `findSimilar` deliberately calls `generateEmbeddingUncached` (`embeddings.ts:483`), bypassing the cache, on a client capped at `max: 2` connections that the file's own header says is not for hot-path traffic.
- **But `pg_trgm` 1.6 is already installed** (schema `extensions`, verified via `pg_extension`). A trigram-similarity tier over `phrase_map.normalised_phrase` runs inside the existing `withTenantContext` query, costs **zero network round trips**, is **deterministic**, needs **no extension migration**, and yields a real number in [0,1].

**(C) That number is also the answer to item 2.** `MIN_CONFIDENCE` (`level1.ts:28`, read only at `level1.ts:135`) is the *model's self-reported* confidence — `openrouter.ts:82` coerces a missing value to `0`, and the prompt at `openrouter.ts:37` asks for it. It is structurally incapable of being consulted before the call. A pre-escalation confidence has to be a **software-side** score, and trigram similarity against the promoted phrase corpus is exactly that. **Items 2 and 3 are one build, and 3 must land first.** Your ordering has them the other way round.

**Revised order: 1 → (3+2 merged) → 6-lite; with 5 and the client fixes running in parallel. Item 4 folded into 1.**

---

## STEP 0 — BLOCKING PRECONDITION (no code, owner-gated)

Settle the value of `AI_PROVIDER` in Vercel Production for `veridian-ai-os/veridian-compliance-ai`.

`adapter.ts:88` defaults to `"claude-cli"`; under that default `assertAiProviderAllowed` throws for every `userId !== RAJAT_USER_ID`, and `RAJAT_USER_ID` is absent from Production entirely — so it throws for **100%** of users. `runLevel1` calls it at `level1.ts:96` before any model work, and `dry-run.ts:220` swallows the throw. **If that is the live state, the current software/AI split is already 100/0 — by refusal, not by capability, and a measurement build that does not distinguish those two will hand the owner a triumphant 100/0 that means "the AI is switched off".**

Do not flip it. It opens L1 to all 1093 users with live OpenRouter spend, against a documented spend-cap history. Surface it; the owner decides. Meanwhile **Step 1 must record refusal as a distinct outcome** (below), which makes the measurement honest under either answer.

Corroboration that L1 has never resolved anything here: `compliance.reuse_cache` = **0 rows**, and `reuse-cache.ts:143-145` writes one on every successful L1 resolution.

---

## STEP 1 — MEASUREMENT *(strictly sequential internally; 1a → 1b → 1c)*

### The correction to the brief
The split is not merely unpersisted on the live path — **it is never computed there.** `dry-run.ts:219` is literally `resolutions = level1.resolutions;`, discarding the `modelCalls` and `cacheHits` that `ReuseCacheOutcome` (`reuse-cache.ts:72-75`) already returns. Widening `submitForVerdict`'s log line first would print nothing. Also note `modelCallCount` is a **module-level `let`** at `run-submission.ts:331`, reset only at `:348` — so even the `runSubmission()` figure is not per-request-safe under concurrency. Do not extend that pattern.

### 1a. Recover the counters inside the dry-run engine
**Files:** `src/lib/pipeline/dry-run.ts:89` (`DryRunResult`), `:207-222` (try/catch), `:194` (signature).

Add `telemetry: { segments, resolved, l0Hits, modelCalls, cacheHits, level1Refused: boolean }` to `DryRunResult`. Capture `level1.modelCalls` / `level1.cacheHits` at `:219`; in the `catch` at `:220` set `modelCalls: 0, cacheHits: 0, level1Refused: true`. Count `l0Hits` in the existing `for` loop at `:224` using the same rule `classify-only.ts:117-120` already uses (`c.verdict !== "gap"` → resolved++; `c.level === 0` → l0Hits++) so the two engines cannot drift.

- **Blast radius:** `DryRunResult` is spread into the top level of the `/api/v1/projexa/tasks` 200 body via `DryRunResult = {...} & Omit<DryRunProposal,"segmentText">` at `:89` and `toVerdictResult` at `verdict.ts:179-187`. **Put `telemetry` on `DryRunResult` only and do NOT let it reach `SubmissionVerdict`** — keep it out of the wire contract entirely; `submitForVerdict` reads it off `proposal` before calling `toVerdictResult`. This keeps PROJEXA's `M24Shell.tsx:346-357` type untouched.
- **Breaks:** `dry-run.test.ts` asserts result shapes; additive field, but check for exact-object assertions.
- **Verify:** unit test that a forced-refusal path yields `{modelCalls:0, level1Refused:true}` and a cache-hit path yields `{modelCalls:0, cacheHits:1, level1Refused:false}` — the two must be distinguishable, which is the whole point of Step 0.

### 1b. Persist per-submission — the migration
**File:** new `drizzle/0XXX_r80_part2_submission_telemetry.sql`; `src/lib/db/schema.ts` (submissions block, ~13356-13382).

Live `compliance.submissions` has exactly 10 columns (verified: `id, org_id, project_id, mode, selected_chain, raw_input, user_id, status, created_at, classification`). Add, all **nullable**:

```
segment_count int, resolved_count int, l0_hits int,
model_calls int, cache_hits int, level1_refused boolean
```

Nullable is load-bearing: the 50 existing rows, plus `runDirectTask` (`:667`) and `runSubmission` (`:359`) which will not write them, must stay distinguishable from a measured zero. **Do not backfill** — the values cannot be reconstructed honestly, and a fabricated 100% software rate is exactly the failure this item exists to prevent.

Then extend the single UPDATE at `run-submission.ts:1196-1200` (already inside `withTenantContext`, so RLS is not an obstacle) and widen the `console.info` at `:1202-1205` to match `runSubmission`'s line at `:597-600`.

- **Blast radius:** additive DDL, no enum change, no `ALTER TYPE`. Reversible.
- **Breaks:** the column comment at `schema.ts:13374` asserting classification is "computed once by runSubmission()/runDirectTask()" is already wrong; fix it in the same commit.
- **Verify:** send one typed message from the PROJEXA composer; the new row must carry non-null `segment_count` and `model_calls`. Then `select count(*) filter (where model_calls is not null)` — it must equal the number of typed submissions since deploy, not fewer.

### 1c. Ledger at the un-bypassable chokepoint
**File:** `src/lib/pipeline/level1.ts:100-112`.

This is the only line in `src/lib/pipeline` that talks to a model, and all three entrypoints funnel through it (`dry-run.ts:209` via reuse-cache, `run-submission.ts:888`/`:949`, `classify-only.ts:84`). Write one `logTokenUsage` row per call.

**Constraint you must respect:** `token_usage_ledger.provider` and `.model` are NOT NULL, and `AiProvider.classify()` (`adapter.ts:42`) returns bare `ClassificationResult[]` — no usage, no model name. `openrouter.ts:62` resolves the model internally and `:59-71` destructures only `{ data }`, throwing away the `usage`/`durationMs` that `callLLMJson` returns.

Two sub-options, in this order:
- **1c-i (do now):** widen `AiProvider.classify` to return `{ results, model, provider, usage?, durationMs? }`. Two implementers must change together: `openrouter.ts:55` (has everything already) and `claude-cli.ts:114` (has nothing — return `usage: undefined` honestly, never a fabricated number).
- **1c-ii:** call `logTokenUsage` from `level1.ts` with `level: "pipeline_l1"`, `success:false` + `failureReason` on the provider-throw branch at `:107-112` (which already returns `modelCalls: 1`), and `taskId: submissionId` — which needs `submissionId` threaded into `Level1Context`. **`logTokenUsage` already swallows its own errors (`token-usage-service.ts:84-86`), so a ledger failure cannot fail a user's request** — that is what satisfies the reliability constraint. It is still `await`ed; make it fire-and-forget with a `.catch(()=>{})` so it adds no latency to the response.

**Pick the `level` vocabulary now and write it down.** `token_usage_ledger.level` is unconstrained free text (0524 left it so deliberately) and `schema.ts:10187` currently points its comment at `escalation-tier-catalog.ts`'s `PERCEPTION|REASONING|AUTHORITY`. **Use the pipeline's own vocabulary (`pipeline_l1`/`pipeline_l2`), repoint that comment, and delete the catalog (Step 5).** Two vocabularies in one unconstrained column makes it permanently unqueryable.

- **Blast radius:** three files + `adapter.test.ts` + the L2 batch path's provider object (`analyse.ts:192`).
- **Verify:** `select level, success, count(*) from compliance.token_usage_ledger group by 1,2` must go from 14/0-non-null to showing `pipeline_l1` rows — or, if Step 0 resolves to claude-cli, must show **zero new rows plus `submissions.level1_refused = true`**, which is the honest answer.

---

## STEP 2 — THE FUZZY TIER + CONFIDENCE GATE *(one build; strictly after Step 1a)*

### Where it sits — and why an L0 exact hit never pays for it
**Inside `resolveMissesWithReuseCache`, between the cache-hit loop at `reuse-cache.ts:115-127` and the escalation gate at `:129`.**

This is the correct seam and it is the reconcile-don't-rebuild answer:
- A segment that hits any L0 tier returns at `level0.ts:267-301` and is never in `missIndices` (`dry-run.ts:199`) — **it never reaches this function at all.**
- A segment that hits the sha256 `reuse_cache` is resolved at `:115-127` and lands in `resolutions`, not `stillMissing` — it does not pay either.
- Only a segment about to cost a model call reaches the new tier.
- Both live callers (`dry-run.ts:209` and `run-submission.ts:888`) go through this one function, so the composer and the MCP/assistant/submissions routes cannot diverge. `classify-only.ts:84` calls `runLevel1` directly and is deliberately excluded — see Discards.
- The existing `runLevel1Fn` DI seam and `reuse-cache.test.ts` are reused as-is.

### The query
One extra SQL statement, batched for all misses, inside the existing `withTenantContext` in a new `makeL0Repo`-style method in `repos.ts`:

```sql
SELECT normalised_phrase, function_id, fixed_params,
       similarity(normalised_phrase, $1) AS score
FROM compliance.phrase_map
WHERE org_id = $2 AND promoted_at IS NOT NULL
  AND similarity(normalised_phrase, $1) >= $3
ORDER BY score DESC LIMIT 1
```

**Migration required:** none for the extension (`pg_trgm` 1.6 confirmed installed in `extensions`). Add a GiST/GIN trgm index on `(org_id, normalised_phrase)` — but note the table is 186 rows, so the index is for later, not for correctness.

### The confidence gate (item 2)
`score` **is** the pre-escalation confidence, and it exists before any model call:

- `score >= HIGH` (start at 0.85, measured not guessed) → resolve as `{ source: "phrase_fuzzy", level: 0 }`. Follow `reuse-cache.ts:121-124`'s precedent exactly: a software hit is `level: 0` so it counts into `l0HitRate` with no change to the counting logic. **This is the mechanism that moves 95/5.**
- `LOW <= score < HIGH` (0.55–0.85) → **do not call the model, and do not call it a gap.** Return a `needs_input`-shaped ask: "Did you mean *«matched phrase»*?" This is the directive's DATABASE-FIRST rule applied to an ambiguous case, and it turns a paid uncertain answer into a free certain one.
- `score < LOW` → fall through to the existing `if (stillMissing.length === 0)` gate at `:129` and `runLevel1Fn` at `:133`. Unchanged.

`MIN_CONFIDENCE` at `level1.ts:135` **stays** — it is a legitimate post-hoc filter on the model's answer and does a different job. Do not conflate them; add a comment at `level1.ts:28` saying so.

### Blast radius and what could break
- **`confirmSubmission`'s re-derivation guard, `run-submission.ts:1273-1279`.** The confirm leg re-runs the *entire* classification (`proposeSubmission` again) and refuses with `FUNCTION_NOT_AVAILABLE` if `input.functionId !== first.functionId`. A trigram score is deterministic for a fixed corpus, and `phrase_map` changes only on the nightly L2 promotion — so the only flip window is a promotion landing between verdict and confirm. The guard **fails closed** (refuses, does not execute the wrong function), so the worst case is a confusing refusal, not a wrong write. Add a `dry-run.test.ts` case asserting the same input resolves identically twice.
- **Cost of the second classification.** Note that `confirmSubmission` re-running the whole pipeline means a confirmed submission classifies twice and can pay for L1 twice on a `reuse_cache` miss. The fuzzy tier *reduces* that exposure; it does not fix it. Flag separately.
- **`ResolutionSource`** (`classify.ts:28`) gains `"phrase_fuzzy"`. Verified: the union is open and no exhaustive switch depends on it (the same argument the file's own comment makes for `"reuse_cache"`).
- **Latency:** one indexed SQL query on a 186-row table, inside a connection the request already holds. Not the `max:2` embeddings pool. Not a network hop.
- **Free rider, do it in the same commit:** fix `computeReuseCacheKey` at `reuse-cache.ts:67-69`. The doc comment says `\0`; the code uses a **space**, so `(projectId='a', text='b c')` and `(projectId='a b', text='c')` collide onto one key — and a cache hit replays a function+params with **no `validate()` call** on the verdict path. The table is 0 rows *today*, so the fix is free. That window closes the first time L1 succeeds in production.

### Verify
- Threshold calibration is empirical, not copied: build a fixture of the 80 distinct live phrases plus hand-written paraphrases, and measure precision at 0.75/0.80/0.85/0.90 before picking. **Ship with the highest threshold that gives zero false positives on that fixture**, not the one that maximises hit rate.
- After deploy: `submissions.l0_hits / submissions.resolved_count` (Step 1b) must rise, and `model_calls` must fall, over the same traffic. That is the 95/5 number, measured — which is only possible because Step 1 shipped first.

---

## STEP 3 — RETIRE THE THIRD AI LEVEL *(item 5; fully independent, parallelisable)*

**Decision: RETIRE. Delete `src/lib/ai-router/escalation-tier-catalog.ts` and its `.test.ts`.**

Why, on the evidence:
1. **Zero production importers.** I re-ran the grep: the only hits are its own test file and a comment at `schema.ts:10187`.
2. **Its own header** says it is unwired, gated on an unstarted "Phase 6" requiring owner sign-off, and that the tier name is not owner-approved.
3. **Its own test** (`escalation-tier-catalog.test.ts:72-73`) asserts that two of its three PERCEPTION models exist nowhere in the live roster — the file locks in that its strings are unused.
4. **Four independent type walls** would each need widening: the Postgres enum `platform.pipeline_level` (2 labels live), `PipelineLevelRole` (`level-model-registry.ts:27`), `ResolvedFunction.level` typed `0 | 1` (`classify.ts:38`), and `AiProvider` (2 methods, both providers implement exactly those two).
5. **There is no escalation decision point to hang it on.** The ladder is L0 → reuse_cache → L1; an L1 failure becomes a `gap_log` row for the nightly batch, never an in-request second call.
6. **`L3` already means a human approver** in `analyse.ts` (`promotePhraseMapCandidate`) — a second incompatible meaning inside the same subsystem.
7. Its `{provider, model}` shape targets `llm-client.ts`'s `callLLM`, while `AiProvider` takes no model string at all. Wiring it means either changing the provider contract or duplicating model resolution — and its own header declines to merge them.

Most importantly: **the directive says AI ESCALATION LAST and targets under 5% AI. Building a third, more expensive AI tier is the opposite of the directive.** Widening the resolution type would also silently corrupt `l0HitRate` — `reuse-cache.ts:121` deliberately records a cached L1 answer as `level: 0` so it counts as a free hit, and adding levels without auditing every consumer breaks the one metric that tells you how often the pipeline is model-free.

**Also in this commit:** repoint `schema.ts:10187`'s comment from `AiEscalationTier` to the pipeline's `pipeline_l1|pipeline_l2` vocabulary, closing the ambiguity Step 1c depends on. Record the retirement in `platform.claude_log` with this reasoning so it is not rebuilt.

- **Blast radius:** two file deletions + one comment. **Nothing can break** — that is the entire argument.

---

## STEP 4 — THE DISCARDED PER-SEGMENT ARRAY *(item 6; scoped down; independent, parallelisable)*

**Do the honesty half now. Defer the full multi-outcome renderer.**

The reason to scope down is a server fact, not a client one: **`confirmSubmission` can only ever execute ONE proposal** — `run-submission.ts:1274` is `proposal.proposals.find((p) => p.functionId)`. Rendering N confirmable outcomes would show the user buttons that cannot all work. The full fix is a server change (per-segment confirm) plus a client state redesign, and it is not what moves 95/5.

### 4a. The proxy status bug — fix first, it is a real user-visible defect
`C:\ct\projexa\src\app\api\tasks\route.ts:90` stamps `status: 201` on **every** successful upstream response, including `confirmSubmission`'s deliberate HTTP 200 `needs_input` re-verdict (`run-submission.ts:1284-1291`). `M24Shell.tsx:2565-2586` handles that case inside `if (!res.ok)` while testing `res.status === 200` — **unreachable twice over**. Result: a confirm that comes back still-incomplete is reported to the user as success, the notice is set, the draft cleared, `loadTasks()` called, and nothing was minted.
- **Fix:** forward the upstream status verbatim at `route.ts:90`, and move the `needs_input` handler out of the `!res.ok` block. **These two must ship together** or the submit leg's `!res.ok` reasoning shifts.
- **Blast radius:** PROJEXA only. `M24Shell` already treats 201 as submit-leg success.

### 4b. Stop the silent drop
`M24Shell.tsx:2406-2423`: when `verdicts[0]` is chat/answered/gap, the client calls `setDraft("")` and returns — a task segment behind it is dropped with no trace. Add `verdicts?: SubmissionVerdict[]` to the client type at `:346-357` (the server already sends it, `verdict.ts:71-75`), and when `verdicts.length > 1`, append one line to the existing notice div at `:3456-3461` (which already stacks two `<p>`s, so no layout change): *"I answered the first part. The rest wasn't actioned — send it separately."*
- This is ~20 lines and turns a silent data loss into a true sentence. It is the whole value of item 6 at 5% of the cost.

### Explicitly deferred, with reasons
- The `verdicts[]` map-renderer: band 2 is a single `ReactNode` filled by a four-way ternary (`M24Shell.tsx:3437-3465`); `notice`/`answer`/`pendingVerdict` are three independent `useState` slots. `ConversationBand.tsx:29-42` has the right `turns: readonly ConversationTurn[]` prop but **has never been mounted** — zero JSX call sites outside its test. Unproven in the real shell.
- Surfacing `source`/`level` in the composer: requires copying them from `Classification` (`classify.ts:58-69`) onto `DryRunProposal` at all five `proposals.push` sites (`dry-run.ts:244-326`) plus `verdict.ts:46-69`/`:147-161` — a cross-repo wire-contract change. Worth doing *after* Step 2 exists, so the line has something meaningful to say (`phrase_fuzzy 0.87` is informative; `phrase_map 0` is not).

---

## NOT WORTH DOING — discard list

| Discard | Why |
|---|---|
| **A semantic tier over `compliance.embeddings` / `findSimilar()`** | 80 distinct 18-char phrases is not an embedding corpus. `findSimilar` returns zero rows for every query (model filter + unset `app.current_org_id` under FORCE RLS). It costs an uncached network round trip on a `max:2` pool the file says is not for hot paths. The last demonstrably-real embedding was 2026-08-27; the 2026-09-03 backfill of 838 rows produced **zero** real vectors. Use `pg_trgm`, which is installed and free. Revisit only if the corpus reaches thousands of long-form rows. |
| **Wiring `escalation-tier-catalog.ts` / any L3 tier** | Step 3. Four type walls, no decision point, no owner sign-off, `L3` already means something else, and building a *more expensive* AI tier inverts the directive. |
| **Backfilling `submissions.classification` on the 45 pre-0525 rows** | The values cannot be reconstructed honestly. A fabricated denominator is worse than a NULL one, and NULL correctly means "before this was measured". |
| **Extending `ai-reduction-service.ts`'s `softwareCoverageRatio`** | It measures the capability-learning subsystem (`platform.task_capabilities` via `recordExecutionOutcome`, whose callers are `task-execution-engine` / `dialogue-script-executor` / `ai-team/team-service` — **none in `src/lib/pipeline`**). Live it is one row, 3/0/0, `previous=null`, reporting 1.0. Folding pipeline data in mixes two incomparable denominators and silently changes the meaning of the existing monthly cron series. A pipeline ratio gets its own reader. |
| **Adding the fuzzy tier to `classify-only.ts`** | It writes a `gap_log` row on every call (`:134-145`), including for successful L1 resolutions. It also has an explicitly contract-frozen response shape. Adding a *reading* tier there later is safe; adding a *recording* one is not. Accept that `/classify` and `/tasks` may disagree until `/classify` has a live caller — today it has **zero** (its only references in PROJEXA are its own test and a doc comment). |
| **A confidence field on `ResolvedFunction` sourced from the model** | The model's self-reported number arrives *after* the call and `openrouter.ts:82` coerces a missing value to `0`. It can never be an escalation gate. The trigram score can. |
| **Fixing `dry-run.ts:330-345` executing reads before confirm** | Real, but out of scope and net-negative to change now: the answer text the composer renders comes from that call, and removing it turns every `answered` verdict into a second round trip. Log it as a separate finding. |
| **Flipping `AI_PROVIDER` in production** | Owner-gated, spend-consequential, irreversible-adjacent, and the value is unreadable from here anyway. Surface, do not act. |

---

## DEPENDENCY GRAPH

```
STEP 0  AI_PROVIDER (owner)  ─── informs interpretation of everything, blocks nothing
   │
STEP 1a  dry-run telemetry ──► 1b  migration + persist ──► (readable 95/5 number)
   │                    └────► 1c  ledger at level1 chokepoint   [1c ∥ 1b]
   │
   └──► STEP 2  pg_trgm tier + confidence gate  (needs 1a's counters to be provable)
                    │
                    └──► threshold calibration ──► deploy

STEP 3  retire catalog          ── fully independent, any time
STEP 4a proxy 201 + client fix  ── fully independent (PROJEXA only)
STEP 4b verdicts[] honesty line ── fully independent
```

**Strictly sequential:** 1a → 1b. 1a → 2. 2 → threshold calibration → 2's deploy. 4a's two edits must ship in one commit.
**Parallelisable (three separate agents/branches, zero file overlap):** {1a→1b→1c→2} in `C:\ct\ct\src\lib\pipeline`, {3} in `src/lib/ai-router` + one `schema.ts` comment, {4a+4b} entirely in `C:\ct\projexa`.

**The one ordering rule that matters:** Step 1 before Step 2, always. Step 2 is the change that moves the number; Step 1 is the only thing that can prove it did. Shipping 2 first produces an unfalsifiable claim, which is precisely the state the audit found.

**Key file anchors (verified in tree):** `run-submission.ts:331, 347, 880, 888, 1145, 1175, 1191-1205, 1273-1279` · `dry-run.ts:89, 92-103, 194, 199, 209-222, 243` · `reuse-cache.ts:67-69, 97, 115-127, 129, 133` · `level1.ts:28, 96, 100-112, 135` · `classify.ts:28, 38, 58-69, 89, 252-257` · `level0.ts:267-301` · `repos.ts:18-36` · `verdict.ts:48-75, 179-187` · `adapter.ts:41-45, 63-91` · `openrouter.ts:37, 55-85` · `classify-only.ts:29-69, 84, 134-145` · `embeddings.ts:416-439, 465-490` · `tasks/route.ts:97, 200-224` · `schema.ts:10187, 12889` · PROJEXA `M24Shell.tsx:346-357, 2371-2378, 2390-2430, 2565-2586, 3437-3465`, `api/tasks/route.ts:90`, `ConversationBand.tsx:29-42`.