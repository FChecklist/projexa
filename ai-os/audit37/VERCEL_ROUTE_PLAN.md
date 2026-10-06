# Vercel used as little as possible: measurements, guards and the remaining migration plan (AUDIT-100 A2, A3, A6, A19, A21, A22, A23)

Written 2026-10-05 from MEASURED runs on the fast rig (real Chromium, production build of PROJEXA main 5fb2c294, local Auth stand-in, sync service and
/api answered inside the browser). Nothing here reached a real network. The numbers are printed by the committed specs on every run.

## 1. What is guarded now (committed, re-runnable, observed to fail when broken)

| Guard | File | What it stops |
|---|---|---|
| Route inventory (unit) | `src/lib/vercel-route-inventory.test.ts`, `scripts/vercel-route-inventory.mjs`, `ai-os/audit37/vercel-route-inventory.json` | A new `src/app/api/**/route.ts` that is not named with a reason and a plan; the count rising above 311; a new `/api` call in the on-laptop shell code (`src/lib/local-first`, `src/app/local`) that is not in `shell_api_references`. Falsified by planting `src/app/api/zz-plant/route.ts` (test failed, file removed). |
| Daily-walk budget (e2e) | `e2e/lf-lifecycle-vercel-budget.spec.ts` | A shell module that starts calling Vercel: every module clicked and every module opened by address, online, after the install. Falsified by removing the Dashboard snapshot from the allow-list (failed on `GET /api/dashboard/project/:id`, restored). |
| First use (e2e) | `e2e/lf-lifecycle-first-use.spec.ts` | More than 8 user actions to the first useful screen; any set-up step after pressing Sign in; sign-in to ready over 90 s; an offline BOQ edit sent while offline or sent twice. Falsified with the action budget set to 5 (failed, 7 measured). |
| Resources (e2e) | `e2e/lf-lifecycle-resources.spec.ts` | Heap, DOM nodes, main-thread seconds and storage of the install and of the heavy Dashboard (5,142 rows) above 5x-8x their measurement; the heavy work going to the server. Falsified with an injected heap leak (221 MB against a 60 MB budget, restored). |
| No email at sign-in (e2e) | `e2e/lf-lifecycle-signin-no-email.spec.ts` | Any request that sends mail during the first sign-in, a sign-out and two more sign-ins. The detector is proved on the real "forgot passcode" page (Auth recover call) and by planting that call into the sign-in helper (14 mail requests named, restored). |
| Whole app on the laptop (e2e) | `e2e/lf-lifecycle-whole-app-on-laptop.spec.ts` | An install that leaves a manifest file out of the laptop's release cache (747 of 747 present); a file downloaded in the background; the file caps (60 MB per file, 150 MB recent with the oldest dropped, pinned never dropped) in real Chromium. Falsified by shrinking the files to 45 MB (the "oldest dropped" assertion failed, restored). |
| Plan (unit + script) | `scripts/verify/vercel-plan-check.mjs`, `src/lib/vercel-plan-check.test.ts`, `A1_VERCEL_PLAN_EVIDENCE_2026-10-05.md` | Plan other than Hobby, or a paid add-on. |

## 2. What was measured

Counts are what the browser SENT, by destination; a page request answered by the service worker from the laptop's own copy is not counted (it never left).

| Window | /api (Vercel function) | app pages (Vercel) | static files | Edge sync | Notes |
|---|---|---|---|---|---|
| First install, incl. the legacy page it opens on | 5 (`/api/shell`, `/api/notifications`, `/api/tasks`, usage beacon x2) | 21 | 53 | 38 | released once per laptop; 4 Auth calls |
| First session after the install, BEFORE step 1 (no hand-over) | 4 | 20 | 62 | 13 | FINDING 1 below (5 of the pages were the prepare screen's warm-up prefetches) |
| First session after the install, AFTER step 1 (2026-10-05): hand-over + 12 module clicks | 2 (Dashboard snapshot, beacon) | **0** | **0** | 7 | handed over by itself, 0 user actions; `A3 step 1` test |
| Daily: click every one of 41 module entries inside the shell (online) | 2 (Dashboard snapshot, usage beacon) | 0 | 0 | 3 | |
| Daily: open every one of the 41 entries by address (fresh load) | 1 | 0 | 0 | 124 (3.0 per load) | all assets from the laptop |
| Open the heavy Dashboard (5,142 rows) | 2 (snapshot, beacon) | 0 | 0 | 4 | all counting on the laptop |
| Edit a BOQ line while online | 1 (`PATCH /api/scope/line-items/:id`) | 0 | 0 | 0 | offline it waits, then the same PATCH once; step 3 BLOCKED (server op missing) |
| Three sign-ins on one laptop | 0 mail requests | | | | BEFORE step 1b: 3 release bundle downloads (FINDING 2); AFTER: **1** (the first install only) |
| Signed out, offline, `/login` (B20) | 0 | 0 | 0 | 0 | the passcode form opens from the kept release; 0 Auth calls; `lf-lifecycle-offline-passcode` |

Resources on the laptop (Chromium Performance metrics after forced GC; `navigator.storage`): retained JS heap 5.2 MB after the install of a 5,142-row person,
5.6 MB with the heavy Dashboard open, 7.7 MB after walking 41 modules; the install costs 0.8 s of main thread, the heavy Dashboard 0.8 s (script 0.12 s) and
draws in 459 ms, the 41-module walk 5.2 s; storage used 13.6 MB, of which the release cache is 8.9 MB (747 files). Budgets are 5x-8x these, in the spec header.

Routes: **311** `src/app/api` routes (282 proxy VERIDIAN's backend, 17 own logic, 12 talk to Supabase). Edge side: `projexa-sync` (16 routes), `ai-work-link`,
`ai-work-link-exec`, `projexa-read`, `projexa-timer`, `projexa-scheduler-bridge`, `projexa-document-extract`. The on-laptop shell can call exactly 8 `/api` routes
(dashboard snapshot, exceptions, BOQ analysis, BOQ line PATCH, three file-signing routes, the beacon); a daily walk uses 2 of them.

Journey (A19/A23): sign-in press to installed-and-ready 7.1 s on the rig (network ~0); opening the page to the BOQ lines on screen 9.8 s; **0 user actions after
pressing Sign in for the install**; 7 user actions from the sign-in page to the BOQ (open, email, passcode, Sign in, open again, Scope, the BOQ).

## 3. Findings (real, not fixed here; each has a step below)

1. **FIXED 2026-10-05 (step 1).** ~~The first session stays on Vercel until the next full page load.~~ After the install finishes the person is still on the legacy server-rendered `/dashboard`;
   its links are Next.js client navigations (RSC fetches), which the service worker deliberately never answers (`sw-core.ts`: "RSC payloads ... the network").
   Measured: 20 app pages + 4 `/api` calls in that first session. Only a reload / reopening serves the shell from the laptop.
2. **FIXED 2026-10-05 (step 1b).** ~~Each sign-in downloads the 8.9 MB release again.~~ Sign-out deletes the release caches by design (`sign-out-keeps-app.test.ts`: "the next person starts from
   nothing"), the next sign-in re-installs: 3 bundle downloads over 3 sign-ins. The bundle is public build output (no person's data), so the deletion is not
   needed for privacy.
3. **A BOQ edit made online is a Vercel call**, while the same edit made offline later goes the same way (`pending-edits.ts` -> `/api/scope/line-items/:id`).
   **BLOCKED on a server-side addition (2026-10-05, step 3 stopped here as ordered).** The edit is a line's `category`. The sync service's `/push` runs functions
   of the AI work link registry, and none of them is this edit at the same rights: `update_boq_line` (member, rank 2, level 1) takes only
   `description`/`unit`; `update_line_item_budget` does take `category` (same service call, `updateLineItemBudget`) but is manager-only (rank 3), link
   level 2 and money-sensitive, while the online route `PATCH /api/v1/construction/boq/line-items/[id]` lets a MEMBER change a category
   (`requireRoleOrScope(ctx, "member", "write")`). Routing the edit through `update_line_item_budget` would therefore refuse edits members make today.
   Needed, in compliance-tracker: a category-only BOQ line write at member rank (add `category` to `update_boq_line`, or a new
   `update_boq_line_category` -> `updateLineItemBudget({ category })`) in `src/lib/pipeline/function-registry.ts` + `executor.ts`, the generated edge registry
   (`supabase/functions/ai-work-link/function-registry.generated.json`), the live function table (seed migration), and a deploy of
   `ai-work-link-exec` / `projexa-sync`. Then in PROJEXA: replace `createEditQueue()` (pending-edits.ts) with an outbox `enqueue({ functionId, projectId,
   params: { projectId, lineItemId, category }, record: { kind: "boq_lines", id, baseVersion } })` and delete the PATCH call and its inventory row.
4. **Dashboard, exceptions and BOQ-analysis snapshots, and the three file-signing routes, are Vercel calls** (computation lives in the VERIDIAN backend).
5. Login, sign-up, the legacy pages and ~300 online-only screens' proxies stay on Vercel; none is reachable from the shell's daily walk (measured 0).

## 4. Remaining migration plan, in order of benefit per effort

| Step | Change | Saves (measured) | Where | Effort |
|---|---|---|---|---|
| 1 DONE | After "ready", navigate once to the shell (`window.location.assign` of the current path, which the worker now answers with the shell) and keep the release cache on sign-out when the same person signs in again (it is public) | 20 pages + 4 `/api` in the first session; 8.9 MB per later sign-in | PROJEXA `WorkspacePrepare`, `sign-out*.ts` | small; touches the install e2e specs, so do it in its own PR |
| 2 | Edge Function `projexa-read` serves the Dashboard / exceptions / BOQ-analysis snapshots from the same SQL the backend uses | the only daily `/api` call (1 per Dashboard open) | compliance-tracker `supabase/functions/projexa-read`, PROJEXA `dashboard-adapter.ts`, `analysis-adapter.ts` | medium: the figures are computed in the backend service layer |
| 3 BLOCKED (server op, see finding 3) | Send the online BOQ line edit through the outbox `/push` op the offline path will use, then delete the PATCH call | 1 `/api` per edit | `pending-edits.ts`, `projexa-sync` push | medium: needs the registry op for BOQ category |
| 4 | Edge Function mints the signed file URL | 3 routes per pinned/opened file | compliance-tracker | small |
| 5 | Serve `/_next/static` and `/_release` from Cloudflare Pages (static, no function) and keep Vercel for login pages and the proxies | the ~60 static files + 8.9 MB per install | OWNER decision (DNS/hosting), see `STEP4_STATIC_EXPORT_INVENTORY_2026-09-22.md` | owner |
| 6 | Rank the ~300 remaining proxies by real use before moving any: the server's `withTiming` lines per route over 48 h with real users | tells which of the 282 proxies carry traffic | owner reads Vercel usage / logs once Vercel is live | owner + small |

After steps 1-4 a daily session is edge-only (Supabase); Vercel carries the login pages, the one-time install and the online-only screens.

## 5. Status of the rows

A1 VERIFIED (plan tier today; owner reads the monthly meters). A2, A3 PARTIAL: measured, guarded, every remaining route named with a reason and a plan;
steps 1 and 1b DONE (2026-10-05, section 7); step 3 via /push BLOCKED on a server-side op (finding 3), but the online BOQ line PATCH no longer reaches Vercel on production since A2 moved it to the projexa-api Edge Function (section 6); steps 2, 4 open; 5 and 6 are owner steps. B20 VERIFIED on the fast rig. A6 VERIFIED against the stated policy (files only if pinned or recent, caps held in real Chromium); the literal "whole app incl. all files" is
a policy choice the owner already made. A19, A23 VERIFIED on the rig (journey, 0 set-up actions, 7 actions, timings committed); real-network timing belongs to the
live install lane. A21 VERIFIED (measured and budgeted). A22 VERIFIED (zero mail requests over three sign-ins).

## 6. A2 edge proxy (2026-10-05, ai-os/audit37/A2_PROGRESS.md)

The Supabase Edge Function `projexa-api` (compliance-tracker `supabase/functions/projexa-api`) answers the 7 proxy routes the shell reaches
(dashboard / exceptions / BOQ-analysis snapshots, BOQ line PATCH, the three file-signing reads) with the Next handlers' exact contract
(`src/lib/projexa-api-parity.test.ts`, 122 cases; live smoke 24/24 identical). On https://projexa-ai.com the browser calls it through
`src/lib/px-api.ts`; the Next handlers stay as the same-origin fallback. Shell-reachable routes answered by Vercel: 8 -> 1 (the beacon).

BATCHES 2-4 (2026-10-06): all 106 plain proxies of the online screens moved the same way (A2_PROGRESS.md): 113 routes answered by
the edge on the production origins. BATCH 5 (2026-10-06): 72 proxies that were plain in all but form (own role sets, the VERIDIAN root,
empty / lenient / defaulted bodies, options in any order): 185 routes. BATCH 6 (2026-10-06): 32 proxies with their own validation,
query rebuilding or answer reshaping, each statement ported as spec data and proven by the contract: 217 routes. **Vercel-served /api
routes 304 -> 264 -> 231 -> 198 -> 126 -> 94 -> 80 (batch 7) -> 76 (batch 8)** (`vercel_served_routes_budget`, may only go down).

Remaining on Vercel after batch 6 (311 route files: 282 VERIDIAN proxies of which 217 moved; 65 proxies + 29 own-logic/Supabase = 94).
`bun scripts/projexa-api-candidates.mjs` prints the reason per proxy. Each class needs a real port + parity, not a spec key:
1. Binary / multipart (21): uploads (`/documents/:id/versions`, `/site-instructions` POST, `/projects/from-document`, `/scope/import`, `/schedule/import`, `/labour-roster/import`) and PDF / xlsx
   downloads and share links (`/attendance/summary/pdf`, `/attendance/summary/share`, `/moms/:id/pdf`, `/payroll/payslips/:id/pdf`,
   `/quotations/:id/pdf`, `/shared/mom/:token/pdf`, `/work-progress/report/pdf|xlsx|share`, `/drawings/export`, `/scope/import/template`,
   `/reports/:reportName/export` and `/share`, `/reports/budget-variance/export`, `/construction-materials/cost-report/export`): stream passthrough with
   the Next handlers' content-type / disposition / size fallbacks and the 30 s upload budget; parity with real small files incl. oversize
   and wrong type. The uploads of `/documents`, `/drawings` and `/permits` (POST) share a handler file with a cached list (class 2).
2. [DONE in batch 7, 2026-10-06: 232 routes on the edge, Vercel-served 94 -> 80; the 12 write-invalidating ones through the browser's one call to the new `/api/cache/revalidate`, see A2_PROGRESS.md] Cross-request cache (15): `module-list-source` lists (`/documents`, `/drawings`, `/labour-roster`, `/materials/master`, `/meetings`,
   `/moms`, `/mood-boards`, `/permits`, `/scope`), `unstable_cache` (`/projects`, `/knowledge-base`, `/knowledge-base/:id`) and
   `createCachedVeridianGet` (`/cost-centers`, `/currencies`, `/fiscal-years`): a per-isolate Map with the same TTL and the same
   invalidation on the writes, parity with a fake clock.
3. [PARTLY DONE in batch 8: category-distribution (2 routes) and the company dashboard / departments moved; `/api/shell`, `/companies/:companyId/projects/:projectId` and `/api/work-progress/report` need their own design step, see A2_PROGRESS.md] Fan-out / composition (7): `/api/shell`, the four dashboard-hierarchy routes (`company-scope`), `/projects/:id/category-distribution`,
   `/work-progress/report`: same call order and error semantics.
4. Own logic beyond a statement (17): `/scope/:id` (boq-helpers), `/scope/:id/revisions`, `/billing-claims/:id` (finance / decide action
   sets), `/projects/:id/approvals` (submission id + upstream status extra), `/organization/currency` (ISO code normalising), `/discuss`
   (trim + history default), `/attendance` (ISO date filter + ruleCode extra), `/work-progress` POST (ruleCode / missing answer),
   `/rfis` and `/punch-list` and `/submittals/:id` (notification-service), `/moms/:id/share-links` (origin env), `/pill-usage`,
   `/reports/:reportName` (templated fallback), `/capability-tree`, `/chain-options`, `/veridian-link` (redirect).
5. Server-side only (5): `/ai/apply` (db), `/assistant` and `/org/provision` (Supabase server client), `/org/repair` (drizzle),
   `/classify` (its own service message): stay until their own design step.
6. The 29 own-logic / Supabase routes STAY on Vercel by plan: the usage beacon (`/api/local-first/client-error`, `/prepare-report`), contact,
   e-mail (`/api/email/*`, digest), webhooks and Google Sheets (server secrets), AI chat (`/api/conversations*`), provisioning and invites
   (`/api/org/invites*`, `/api/org-members*`, `/api/organization*`), notifications / todos / search / preferences / work-progress photos
   (PROJEXA's own Supabase tables), the company list of dashboard-hierarchy.
7. Delete a Next handler only when no caller needs the same-origin fallback (kill switch) any more.

## 7. Steps 1 and 1b, done 2026-10-05 (AUDIT-100 A3; B20 closed with them)

- **Step 1, hand-over.** `src/lib/local-first/release/shell-handoff.ts` + `src/components/local-first/LocalShellHandoff.tsx` (mounted once in the (app) layout):
  when the prepare screen has installed the release AND finished the projects copy (or the boot set the worker's pointer again after a sign-in), the
  server-rendered page replaces itself with the same address, which the worker answers with the shell from the laptop. Never on a `px-server` page,
  never while a field is edited, never while a projects copy runs in the page, never twice for the same address within 60 s (no reload loop). Until
  then a plain in-app link click is a full navigation instead of an RSC fetch. The prepare screen's ten-route warm-up (RSC prefetches) now runs only
  with local-first off. Measured: first session 0 app pages, 0 static files, 2 /api (the Dashboard snapshot and the beacon, both on the daily list);
  before: no hand-over (the spec failed at "handed over"), 5 app pages even with the person idle. First use: 6 user actions to the BOQ (was 7).
- **Step 1b, the release kept across a sign-out.** The default sign-out sends `CLEAR_PERSON keepRelease`: the worker keeps the release cache, marked
  signed out. Online nothing changes for a signed-out laptop (no shell is served first: the server's login page). The same person's next sign-in
  points the worker at it again (no download: 1 bundle over three sign-ins, was 3). Another person's sign-in drops it first
  (`dropReleaseKeptForAnother`, and the worker refuses `USE_RELEASE` of a kept release for someone else), and "Sign out and delete this laptop's copy"
  deletes it as before. The person's DATA handling is unchanged (B12 green).
- **B20, offline passcode sign-in.** With no network the worker opens the shell from the kept release for any address, `/login` included; the shell's
  signed-out screen is now the offline passcode form (`OfflinePasscodeSignIn.tsx`, the same `offline-pin.ts` check as the login page). Proved on the
  fast rig by `e2e/lf-lifecycle-offline-passcode.spec.ts` (failed before: the sign-out deleted the release); the real-backend copy in
  `e2e/audit37-real-b17-b20-offline.spec.ts` is no longer `test.fail`.
