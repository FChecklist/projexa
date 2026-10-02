# PROJEXA local-first: what a laptop costs our servers (measured)

Package lf-e6, 2026-10-02. Requirement R14 (cost near zero), G4 (our server minimal). Owner's priority: **cost first**, ease of work second, security third.

## The quota that matters

- **Supabase Edge Function invocations: 500,000 a month on the free plan, shared by EVERY laptop of every organisation.** One HTTP request to `projexa-sync` is one invocation. A pushed edit is **two**: the push request and the `ai-work-link-exec` run the sync function makes for each op (handler.ts `execRun`).
- **Vercel**: once the release is installed and local-first mode is on, a normal person's navigation never reaches Vercel (section "Vercel" below). The Vercel bill is the static bundle download and a few named exceptions.

## How the numbers were measured

`src/lib/local-first/cost/harness.ts` builds simulated laptops out of the **real** laptop code (sync client, replica, outbox and LocalShell's flush scheduler, the auto-sync scheduler with its server step and attestation refresh, the jobs claim loop, the shell's daily manifest refresh), points them at the shared fake sync server (`__fixtures__/fake-sync-server.ts`, real HTTP `Response`s) and counts every request by route on a simulated clock. Only one count is by rule rather than by running the code: the release check (`persistence.ts`: at most every 6 hours, 2 × `GET /release/current`), because the release installer needs Cache Storage and a service worker.

Setting: **5 projects × 28 kinds** (the backend's `SYNC_KINDS`), 2 rows per kind plus 20 tasks per project. A working day = 8 hours.

Run it: `bun test --isolate src/lib/local-first/cost/cost-budget.test.ts` (prints the table; ~15 s). That test **fails** when a scenario exceeds its budget in `cost/budget.ts` `SCENARIO_BUDGETS`, so a future change that adds polling, a sweep or a per-navigation call is caught before it reaches the bill.

## Results (requests per laptop)

| Scenario | Before (code as it was) | After (this package) | Budget (enforced) |
|---|---:|---:|---:|
| (a) idle 8 h, online, tab visible, nothing changes | 94 | **50** | 60 |
| (b) working day: 30 own edits, 30 colleague changes, 40 screens opened | **14,159** | **209** | 260 |
| (c) cold start, empty database, 5 projects | 315 | **163** | 175 |
| (d) offline 3 days (200 changes meanwhile), reconnect: the catch-up | 1,173 | **18** | 25 |
| (e) 10 laptops of one organisation, peers connected, each a working day | ~14,096 | **212** | 260 |
| jobs claim loop, if switched on, 8 idle visible hours | 252 | **35** | 45 |

Requests while offline in (d): **0**, before and after. After the catch-up in (d), every task on the laptop is at the server's version (asserted).

Breakdown after (from the test's printed table):

```
idle8h                      50  (release_current 2, manifest 2, attest 1, changes 45)
workday                    209  (release_current 2, manifest 3, attest 1, changes 116, push 30, execOps 30, pull_ids 27)
coldStart5Projects         163  (release_current 2, manifest 2, changes 18, pull 140, attest 1)
reconnectAfter3Days         18  (release_current 2, manifest 2, changes 8, pull_ids 5, attest 1)
tenLaptopsPerLaptop      212.2  (release_current 2, manifest 2.9, attest 1, changes 92, push 30, execOps 30, pull_ids 54.3)
jobsClaimIdle8h             35  (jobs_claim 35)
```

### Per day, per month, how many laptops

- A working laptop: **209 a working day → 4,598 a month (22 working days)**.
- Add the weekly id-list repair, which an 8-hour run does not reach: at most 12 `/ids` per whole sync and each feed-covered (project, kind) at most once a week = 140 pairs a week for 5 projects, **about +20 a working day** spread over the week. Steady state: **~229 a working day, ~5,040 a month**.
- **500,000 / 5,040 ≈ 99 laptops** inside the free quota (the budget test asserts ≥ 80 on the 8-hour figure: it measures 108).
- A laptop that is closed costs nothing (no server, no timer). A laptop with only peers online and our server down costs nothing.
- Before this package, the same working day was 14,159 requests ≈ 311,000 a month: **one laptop used 62 % of the free quota.**

### Consistency with the backend's model

`compliance-tracker/scripts/verify/projexa-local-first-cost-model.mjs` (package lf-b4) estimates from assumptions instead of measuring. With `--projectsPerUser 5 --idsRepairsPerDay 0.15 --syncIntervalMin 5 --pushBatchOps 1 --jobsPollSec 0 --peerShare 0` it says **~162 Edge calls a working day, ~139 users** before the quota binds; on its defaults (daily id repair, jobs polling every 5 min) it says ~77 users. The measured laptop is close to the tuned model, a little higher, for named reasons:

| | Backend model | Measured | Why they differ |
|---|---:|---:|---|
| `/changes` | 72 (one project per 5-minute tick) | 116 | the model counts only the timer; the real app also reads a project's feed when a screen opens (40 screens, coalesced within 2 minutes) and right after a push (LocalShell revalidates what it sent), and reads the other 4 projects hourly |
| pull by ids | 4 | 27 | the model assumes changes arrive in 4 batches a day; each of the 30 colleague changes here lands at a different moment |
| push + exec | 30 + 30 | 30 + 30 | same (one op per flush, as LocalShell flushes after every edit) |
| id repair | 21 | 0 in 8 h, ~20 a day amortised | same rule (weekly), the model spreads it evenly |
| open (manifest, release, attest) | 5 | 6 | the shell's own daily manifest refresh |

The model is right that the id repair and the jobs poll were the two biggest fixed costs; the measurement found a bigger one the model did not: **every moved change-feed head re-pulled all 140 (project, kind) pairs** (13,230 of the 14,159 requests).

## What was changed (and where)

| Cost found by the harness | Fix | File |
|---|---|---|
| A moved head (any edit, yours or a colleague's) ran a whole sync: manifest + 140 keyset pulls | A (project, kind) pulled to the end whose kind the feed covers (manifest `deletes_supported: true`, true for all 28 backend kinds) is kept current by `/changes` + pull-by-ids only; kinds without it keep the keyset pull | `replica.ts` (run, step 2) |
| The server step asked every project's head each run, then a whole sync | Project mode: the open project's feed every run, the others hourly, a whole sync every 6 hours (new or lost projects, the id repair). One `/changes {after_seq: stored}` is both the head check and the catch-up | `peer/server-step.ts`, wired in `peer/peer-shared.ts` |
| A screen's background revalidation (useLocalFirst, boq-local, LocalShell after a push) = manifest + pull + `/ids` + `/changes` | A one-project run reuses the stored manifest (≤ 6 h, names the project; a 404 re-asks once and clears a lost project as before) and is free within 2 minutes of that project's last feed read | `replica.ts` |
| `/ids` daily per (project, kind), and 140 right after the first copy | Only in whole runs, ≤ 12 per run, weekly for feed-covered kinds, stamped without a call right after a from-scratch copy (that copy started after the feed position was taken, so it cannot hold an untracked delete) | `replica.ts` |
| Server asked on every run even with a peer connected | Peers first: with a verified peer, the server step runs at most every 30 minutes (always on open / online / manual) | `peer/scheduler.ts` |
| Jobs claim every 20 s / 120 s forever | Doubling after each empty claim, capped at 15 minutes; activity or a job resets it | `jobs/runner.ts` |

Correctness is kept and tested: a colleague's change still arrives (by the feed, version-checked), deletes still arrive (tombstones at once, the weekly repair for untracked ones), a project taken away still leaves the laptop, a dirty row is still never overwritten (unchanged code paths). Tests: `cost/replica-cost.test.ts`, `cost/scheduler-cost.test.ts`, `jobs/runner.test.ts`, `cost/cost-budget.test.ts`.

## Package lf-fc (2026-10-02): flag off, pacing, the circuit breaker, sign-out

Measured with the same harness (`cost-budget.test.ts`) and the breaker tests (`cost/replica-breaker.test.ts`, P = 10 projects x 28 kinds, the real sync client
with the app's `maxRetries: 2`):

| Scenario | Before FC | After FC | Test |
|---|---:|---:|---|
| Local-first flag OFF, a person signs in (P=10) | 401 (first sync run by WorkspacePrepare, result never read) | **0** | `replica-shared.test.ts`, `WorkspacePrepare.flag-off.test.tsx` |
| (a) idle 8 h | 50 | 50 | cost-budget (a) |
| (b) working day | 209 | 209 | cost-budget (b) |
| (c) cold start, 5 projects | 163, measured with the server's cap LIFTED | **163 under the REAL 120/min cap: 0 answered 429, busiest minute 101** | cost-budget (c), (c2) |
| (d) reconnect after 3 days | 18 | 18 | cost-budget (d) |
| (e) ten laptops, per laptop | 212.2 | 216.2 (the paced first copy moves each laptop's day one simulated minute later) | cost-budget (e) |
| STORM A: every `/pull` answers 500, P=10 | 851 | **20**, then 0 until the stop ends (every tab) | replica-breaker |
| STORM C: the per-minute cap (40/min in the test) | 639 requests, 519 answered 429 | **43**, at most 6 answered 429 | replica-breaker |
| The daily quota (429, no Retry-After) | 3 tries per pair, every pair | **at most 2 pulls**, then nothing for at least 1 hour | replica-breaker, sync-client |
| Sign out in the evening, sign in next morning (P=10) | 401 (the copy was wiped) | **0 for the copy** (kept by default; the morning's normal feed check only) | sign-out.test.ts "a kept copy really is reused" |

The ten-laptop world keeps the fake's cap lifted: the fake counts every caller against ONE limit, while the real limit is per person.

## Vercel: what a normal navigation costs once the release is installed and local-first mode is on

Read from `next.config.ts`, `vercel.json`, `src/middleware.ts`, `src/app/sw.js/route.ts`, `src/lib/local-first/release/sw-core.ts`, `src/app/local/**`.

**Zero for navigation.** The service worker answers every app navigation with the on-laptop `/local` shell from the verified release cache, and every static file (`/_next/static/**`, `/_release/**`, icons, fonts) cache-first from the same cache, without a request (`sw-core.ts` fetch handler). The shell's router is client-side, and its screens read IndexedDB. `/local` and `/local/[...path]` are `force-static` (pinned by `src/app/local/local-shell-static.test.ts`). Sync, push, attest and jobs go to the Supabase Edge Function, never to Vercel.

What still reaches Vercel, by route:

| Route | Runs | When, for a local-first laptop |
|---|---|---|
| `GET /sw.js` | a serverless function (`dynamic = "force-dynamic"`, `Cache-Control: no-cache`) **plus** the middleware | the browser's own service-worker update check: at most about once a day per laptop (the browser re-checks the worker script on a navigation when its last check is older than 24 h) |
| `PATCH /api/scope/line-items/:id` | a serverless function plus the middleware | **every BOQ line edit made in the `/local` shell** (`shell/pending-edits.ts` sends it this way, not through the outbox / Edge push). Not this package's file (shell); listed under RISKS. |
| `GET /_release/release.json`, `/_release/px-*.tar.gz` | static file, **but the middleware runs** (its matcher, `/((?!_next/static|_next/image|favicon.ico|logo-mark.svg).*)`, includes `/_release/**`) | the release check (at most every 6 hours while online) and an update download |
| `/llms.txt`, `/ai-manual.json` | `force-static` (built once), middleware runs | when the person's own AI reads them |
| `/manifest.webmanifest` (`src/app/manifest.ts`) | a metadata route with no request data (static by Next's default; not pinned by a test), middleware runs | when the browser re-reads the install manifest |
| any page with `?px-server` (`SERVER_PAGE_PARAM`) | the normal server page (SSR) | only when the shell has no local screen for a module and the person asks for the server's page |
| every page, if local-first mode is OFF or no release is installed | the normal app: middleware + SSR per navigation, `/api/**` per data call | the pre-local-first behaviour, unchanged |

Build triggers (`vercel.json` `ignoreCommand`): a push to any branch other than `main` never builds; on `main`, a commit whose changed files are all `*.md`, `*.jsonl`, `*.csv` or under `.github/` does not build; any other `main` commit builds. (Not edited: owner-only.) This package's branch does not build.

Two Vercel costs worth an owner decision (not changed here; `vercel.json`, the middleware and the shell are not this package's files): (1) exclude `/_release/` and `/sw.js` from the middleware matcher (no auth is needed for either; saves an Edge Middleware invocation per release check and per worker update check); (2) send the shell's BOQ line edits through the outbox / Edge push like every other laptop write, so the `/local` shell makes no Vercel function call at all.

## What is NOT counted here

- Supabase **egress** and **Realtime** messages (peer signalling): estimated by the backend model, not measured by this harness (peers are not simulated; their rows move over WebRTC, which costs no invocation).
- Supabase **Auth** token refreshes (`/auth/v1/token`): a separate Supabase service, not an Edge invocation.
- The rate cap: measured since package lf-fc (see its section above): the cold start is paced at 100 a minute and completes under the real cap with no 429.
- Jobs requests from a REQUESTER (`jobs/requester.ts`: enqueue + a get every 1.5 s for up to 8 s ≈ 6 calls per request). Neither the requester nor the claim loop is started anywhere in the app today.
