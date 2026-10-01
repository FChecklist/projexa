# WORK ORDER PROJEXA-LOCAL-FIRST
## The user's own machine does the work. External AI is the user's own. Vercel serves static files only.

**Issued:** 1 October 2026 · **Owner directive:** raajat.agarwal@gmail.com, live session 2026-10-01
**Builds on:** `ADDENDUM_A_BUILD-001_EDGE_AND_BROWSER_FIRST_2026-09-25.md` (this restates its sequence with the new directives; where they differ, this wins).
**Status:** PLAN. Nothing below is built except where marked DONE.

---

## 1. What the owner asked for (in the owner's words, tidied)
1. Few people per organisation use projexa-ai.com, so download the whole app into the user's browser, at the edge, and use the user's own laptop memory and RAM. Goal: minimum, nearly zero, Vercel server credits.
2. Using the user's laptop as a "daughter server" makes sense: it saves our own RAM.
3. Use the **user's own AI, an external AI, not ours.**
4. Order: (1) move AI calls and the digest cron to Edge Functions; (2) row-level policies for one screen, the BOQ line items, proven to isolate one organisation from another; (3) make that screen load and filter in the browser.

## 2. Decisions and honest limits (read before the phases)

| Idea | Verdict | Why |
|---|---|---|
| Browser does the rendering, filtering, totals, drafts, offline work | **YES** | This is the point of the plan. The user's RAM, not our server. |
| Browser reads the user's own data directly from Supabase | **YES, gated** | Needs row-level policies first. Today only 6 policies name `authenticated` across 689 RLS tables, none for PROJEXA business data. Without them a direct read returns nothing, or needs the service key in the browser, which hands every user the whole database. |
| User's laptop as a server for **everyone working on that project** (peer to peer, daughter server) | **YES, owner override 2026-10-02, with the three safeguards below** | Owner decision, in capitals: one user -> that laptop is the server; two or more -> every laptop is an equal server and they sync whenever open. Aim: speed and a zero Vercel/Cloudflare bill. Safeguards (owner approved): (1) Supabase stays the free durable backup and relay, so data survives all laptops being off; (2) a laptop only syncs projects its user already belongs to, checked with that user's own login, never another organisation's data; (3) money and approval figures are revalidated in Postgres. Laptops sleep and sit behind NAT, so WebRTC peer links use Supabase Realtime for signalling and Supabase as relay when no direct link exists. |
| **Presence-based work offload** (owner clarification 2026-10-01): data stays in Supabase; the system knows who is online and hands work to an online user's browser, which runs it on that user's RAM and CPU and returns the result | **YES, with the rules in section 2a** | This is the owner's chosen form of the "daughter server": the laptop is a short-lived worker, never a data store or a server others connect to. Vercel stays out of the compute path. |
| User's laptop as a **local-first replica of their own data** (browser database, syncs to Supabase) | **YES** | This is the safe form of the same idea: each user's browser holds what that user may already see, works offline, and syncs. Saves Vercel and our database load without making laptops servers. |
| Trusted writes (approvals, permissions, final money) in the browser | **NO** | A user can change a number in developer tools before it is sent. These stay in Postgres functions. |
| Work that must run when nobody is logged in (digest email, schedules) | **NO (stays server side)** | Browser code stops when the tab closes. Moves to `pg_cron` to Supabase Edge Function, not to Vercel. |
| Our own AI inside PROJEXA | **OFF; the user's own external AI instead** | See section 3. |

Cost reality (Addendum A4, measured): page serving is under a cent a day while dormant. The lines that threaten the $20 ceiling are build minutes, Speed Insights if it is on, cron invocations, and our own LLM calls. So the order below goes after AI calls and crons first, not after rendering.

## 2a. Presence-based work offload: the architecture and its non-negotiable rules

**Shape.** (1) Every signed-in tab joins a Supabase Realtime Presence channel for its organisation (who is online, tab visible, rough capability: cores, memory, battery/charging, connection). (2) Work that is heavy but safe to run client side (report assembly, BOQ rollups and filters, exports and PDF generation, imports and parsing, drafts) is written as a **job row** in a queue table, not run on Vercel. (3) The best online worker is chosen (see rules), its browser claims the job through a database function, runs it in a **Web Worker** off the main thread, and writes the result back through a database function. (4) If nobody suitable is online, or the claim times out, the job falls back to a Supabase Edge Function. Vercel is never the executor and holds no queue state; at most it serves the static page.

**Rules, because they change how it must be built:**
1. **A user's machine only ever runs work for data that user is already allowed to see.** Never run person A's job on person B's laptop unless B already has A's access to that data. Otherwise B's browser receives A's (or another tenant's) data. Default: a job runs on the **requester's own** machine; only same-organisation, same-project-access work may go to a colleague, and only through that colleague's own row-level-security reads. Cross-organisation offload is forbidden.
2. **A browser result is a proposal, not a fact.** Anything that feeds money, approvals, billing or permissions is recomputed or validated in Postgres before it is accepted (the browser can be altered in developer tools). Only deterministic, re-checkable or purely display work (formatting, filtering, previews, exports for the requester) is accepted as is.
3. **Jobs are leased, not assigned.** A claim has an expiry; a closed tab, sleep or lost connection returns the job to the queue. Results are idempotent, so a job completed twice does no harm.
4. **The user stays in control.** Respect battery saver and low-memory signals, never run while the tab is hidden for long jobs unless the user has opted in, show a small "your machine is helping" indicator, and allow opting out (that user's jobs then fall back to the edge).
5. **No secrets and no service key in the browser.** The worker uses the user's own session and row-level policies, so Phase 3 below is a hard prerequisite.
6. **Everything is logged** (job id, org, claimed by, started, finished, outcome) so cost and abuse are visible.

**Why Realtime and not Vercel for presence:** Vercel functions are request/response and billed per invocation; Supabase Realtime Presence is a long-lived channel that does not run our code per message.

## 3. Use the user's AI, not ours
- The mechanism already exists: the AI work link. The user pastes a prompt into ChatGPT, Gemini, Claude, Grok, DeepSeek, Z.ai or any AI; that AI reads and drafts through the link, and the person confirms writes.
- **DONE 2026-10-01:** one-click prompt button (PROJEXA PR #334, merged). **IN BUILD (local):** a user-wide link that lists all the person's projects, plus "Report on all above" and "Create New Project" (branch `feat/ai-user-wide-link`, backend branch `feat/awl-user-wide-link`).
- **Current testing (owner 2026-10-01):** while testing, the "external AI" is **Claude Code on the owner's own open machine**, acting through the same link. No in-app model is called.
- **TO DO:** switch off PROJEXA's own in-app AI paths the way DPDP's was switched off (compliance-tracker PR #1941 is the reference for the gating pattern). The in-app assistant route and the composer's AI dispatch show "use your own AI" with the prompt button instead. Inventory first (L-01).
- Money rule: nothing the user's AI does costs us an LLM call. Our cost is only the link service (Edge Function) and database reads.

## 4. Phases and boolean tests (each is YES/NO; "YES" needs evidence recorded in `platform.claude_log`)

### Phase 0, now (reading and writing, no risk)
| # | Test |
|---|---|
| L-01 | `EDGE_CANDIDATES.csv` lists every PROJEXA path that calls an LLM or sends email, each marked `OFF` (replaced by user's AI), `MOVE_TO_EDGE` or `STAY`, one-line reason. YES/NO |
| L-02 | `CRON_PLACEMENT.csv` classifies every declared Vercel cron (PROJEXA 1 + compliance-tracker 29) as `PG_CRON`, `STAY` or `DELETE`. YES/NO |
| L-03 | `ai-os/SHARED_BOUNDARY.md` exists (Addendum A, E-16/E-17). YES/NO |

### Phase 1, user's own AI everywhere (the owner's new rule)
| # | Test |
|---|---|
| L-04 | The user-wide link: pasted into an outside AI it shows a numbered list of ALL the person's projects, then "Report on all above", then "Create New Project". Proven by a committed test against the real manual text. YES/NO |
| L-05 | A person of org A cannot see org B's projects through a user-wide link, and a private project is hidden from a non-lead low-rank person. Committed PGlite tests, falsifiability checked. YES/NO |
| L-06 | "Create New Project" through the AI's draft is created only after the person confirms, with the person as lead, within the 5-a-day cap. YES/NO |
| L-07 | Every in-app LLM call path from L-01 marked `OFF` is gated off, and a test proves the route answers "use your own AI". YES/NO |

### Phase 2, AI calls and the digest cron to the edge (owner's step 1)
| # | Test |
|---|---|
| L-08 | Any LLM or email call marked `MOVE_TO_EDGE` runs in a Supabase Edge Function; Vercel invocations attributable to it over 7 days = 0. YES/NO |
| L-09 | The PROJEXA email digest runs `pg_cron` to `pg_net` to Edge Function (the `dpdp-monday-digest` pattern) and is gone from `projexa/vercel.json`. YES/NO |
| L-10 | Both repos' `vercel.json` declare 2 crons or fewer, none `*/N`. YES/NO |

### Phase 3, row-level security for one record type (owner's step 2)
| # | Test |
|---|---|
| L-11 | Every table the BOQ line-items screen reads has a policy naming `authenticated` scoping rows to the caller's org and project. YES/NO |
| L-12 | A signed-in user of org A receives zero rows of org B's BOQ queried directly through PostgREST, no Vercel function in the path. YES/NO |
| L-13 | The service key appears in zero browser-reachable code paths. YES/NO |

### Phase 4, the browser does the work, BOQ only (owner's step 3)
| # | Test |
|---|---|
| L-14 | The BOQ screen loads and renders with the network offline after one online load. YES/NO |
| L-15 | Filtering the largest project (10,907 lines) keeps the longest main-thread block under 50 ms (Web Worker). YES/NO |
| L-16 | Over 24 h of synthetic traffic the BOQ read path shows 0 Vercel function invocations. YES/NO |

### Phase 4b, presence-based work offload (section 2a), after Phase 3
| # | Test |
|---|---|
| L-19 | Each signed-in tab appears in an organisation Presence channel, and a disconnected tab disappears within 60 s. YES/NO |
| L-20 | A job in the queue is claimed by an online browser, run in a Web Worker, and its result is written back and re-read as persisted (R74-RULING-03 e). YES/NO |
| L-21 | A user's machine can never receive a job whose data that user could not read directly: a committed test where a user of org B and a low-rank user of org A are offered org A's restricted job and get nothing. YES/NO |
| L-22 | A claimed job whose browser vanishes is re-queued after the lease and completes on another machine or the Edge Function fallback, exactly once in effect. YES/NO |
| L-23 | A tampered browser result for a money or approval figure is rejected by Postgres. YES/NO |
| L-24 | With the offload live, Vercel function invocations for the offloaded job types over 24 h = 0. YES/NO |

### Phase 5, widen and hold the ceiling
| # | Test |
|---|---|
| L-17 | Local-first replica for the user's own org data (browser database + sync) proven on one more record type. YES/NO |
| L-18 | Projected monthly Vercel invoice is $20.00 or less with every path live. YES/NO |

## 5. Rules for whoever builds this
- Do not start Phase 4 before Phase 3 passes. A browser-direct read without policies either returns nothing or needs the service key in the browser.
- No deployment of anything to Vercel to test it. Test locally and against Supabase.
- Database migrations touch the shared `verdian-ai` database (PROJEXA and DPDP). Record each in `ai-os/boss/ACTIVE-CLAIMS.yaml` before applying, and apply only with the owner's word.
- Closure tests follow R74-RULING-03: a committed, re-runnable test, falsifiability proven, recorded against the requirement id.

## 6. Status 2026-10-01
- DONE: one-click AI prompt (PROJEXA #334); audit-writer pool-clog fix (compliance-tracker #2013).
- IN BUILD (local, not merged, not deployed, no live migration): user-wide AI link, Steps 1 and 2 (L-04..L-06).
- NOT STARTED: L-01..L-03, L-07..L-24.

## 7. Phase P: peer laptops (owner override 2026-10-02)

| # | Test |
|---|---|
| P-01 | First login on a laptop shows the Preparing-your-workspace screen (3 minute ceiling, real progress) and ends with the app cached and the local database opened. Committed tests plus a local browser check. YES (slice 1, branch feat/local-first-workspace-slice1) |
| P-02 | Local database stores records per organisation and refuses cross-organisation overwrites. YES (src/lib/local-first/local-db.ts, tested) |
| P-03 | The user's own projects are copied into the local database after RLS (Phase 3) exists. NO, blocked on L-11/L-12 |
| P-04 | Changes sync laptop to Supabase and back with conflict-free merge (change log + per-record revision). NO |
| P-05 | Two laptops open at once exchange changes directly (WebRTC, Supabase Realtime signalling); one laptop closed catches up from Supabase on next open. NO |
| P-06 | A laptop never receives records of a project its user is not a member of, and never another organisation's (committed test with two users). NO |
| P-07 | A tampered money or approval figure from a laptop is rejected by Postgres. NO (same as L-23) |
| P-08 | With all paths live, Vercel function invocations for project data reads = 0 over 24 h and the projected bill is within the free tier. NO |
