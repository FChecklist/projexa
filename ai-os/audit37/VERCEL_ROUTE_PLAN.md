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
| First session until the person's next full page load | 4 | 20 | 62 | 13 | FINDING 1 below |
| Daily: click every one of 41 module entries inside the shell (online) | 2 (Dashboard snapshot, usage beacon) | 0 | 0 | 3 | |
| Daily: open every one of the 41 entries by address (fresh load) | 1 | 0 | 0 | 124 (3.0 per load) | all assets from the laptop |
| Open the heavy Dashboard (5,142 rows) | 2 (snapshot, beacon) | 0 | 0 | 4 | all counting on the laptop |
| Edit a BOQ line while online | 1 (`PATCH /api/scope/line-items/:id`) | 0 | 0 | 0 | offline it waits, then the same PATCH once |
| Three sign-ins on one laptop | 0 mail requests | | | | 3 release bundle downloads (FINDING 2) |

Resources on the laptop (Chromium Performance metrics after forced GC; `navigator.storage`): retained JS heap 5.2 MB after the install of a 5,142-row person,
5.6 MB with the heavy Dashboard open, 7.7 MB after walking 41 modules; the install costs 0.8 s of main thread, the heavy Dashboard 0.8 s (script 0.12 s) and
draws in 459 ms, the 41-module walk 5.2 s; storage used 13.6 MB, of which the release cache is 8.9 MB (747 files). Budgets are 5x-8x these, in the spec header.

Routes: **311** `src/app/api` routes (282 proxy VERIDIAN's backend, 17 own logic, 12 talk to Supabase). Edge side: `projexa-sync` (16 routes), `ai-work-link`,
`ai-work-link-exec`, `projexa-read`, `projexa-timer`, `projexa-scheduler-bridge`, `projexa-document-extract`. The on-laptop shell can call exactly 8 `/api` routes
(dashboard snapshot, exceptions, BOQ analysis, BOQ line PATCH, three file-signing routes, the beacon); a daily walk uses 2 of them.

Journey (A19/A23): sign-in press to installed-and-ready 7.1 s on the rig (network ~0); opening the page to the BOQ lines on screen 9.8 s; **0 user actions after
pressing Sign in for the install**; 7 user actions from the sign-in page to the BOQ (open, email, passcode, Sign in, open again, Scope, the BOQ).

## 3. Findings (real, not fixed here; each has a step below)

1. **The first session stays on Vercel until the next full page load.** After the install finishes the person is still on the legacy server-rendered `/dashboard`;
   its links are Next.js client navigations (RSC fetches), which the service worker deliberately never answers (`sw-core.ts`: "RSC payloads ... the network").
   Measured: 20 app pages + 4 `/api` calls in that first session. Only a reload / reopening serves the shell from the laptop.
2. **Each sign-in downloads the 8.9 MB release again.** Sign-out deletes the release caches by design (`sign-out-keeps-app.test.ts`: "the next person starts from
   nothing"), the next sign-in re-installs: 3 bundle downloads over 3 sign-ins. The bundle is public build output (no person's data), so the deletion is not
   needed for privacy.
3. **A BOQ edit made online is a Vercel call**, while the same edit made offline later goes the same way (`pending-edits.ts` -> `/api/scope/line-items/:id`).
4. **Dashboard, exceptions and BOQ-analysis snapshots, and the three file-signing routes, are Vercel calls** (computation lives in the VERIDIAN backend).
5. Login, sign-up, the legacy pages and ~300 online-only screens' proxies stay on Vercel; none is reachable from the shell's daily walk (measured 0).

## 4. Remaining migration plan, in order of benefit per effort

| Step | Change | Saves (measured) | Where | Effort |
|---|---|---|---|---|
| 1 | After "ready", navigate once to the shell (`window.location.assign` of the current path, which the worker now answers with the shell) and keep the release cache on sign-out when the same person signs in again (it is public) | 20 pages + 4 `/api` in the first session; 8.9 MB per later sign-in | PROJEXA `WorkspacePrepare`, `sign-out*.ts` | small; touches the install e2e specs, so do it in its own PR |
| 2 | Edge Function `projexa-read` serves the Dashboard / exceptions / BOQ-analysis snapshots from the same SQL the backend uses | the only daily `/api` call (1 per Dashboard open) | compliance-tracker `supabase/functions/projexa-read`, PROJEXA `dashboard-adapter.ts`, `analysis-adapter.ts` | medium: the figures are computed in the backend service layer |
| 3 | Send the online BOQ line edit through the outbox `/push` op the offline path will use, then delete the PATCH call | 1 `/api` per edit | `pending-edits.ts`, `projexa-sync` push | medium: needs the registry op for BOQ category |
| 4 | Edge Function mints the signed file URL | 3 routes per pinned/opened file | compliance-tracker | small |
| 5 | Serve `/_next/static` and `/_release` from Cloudflare Pages (static, no function) and keep Vercel for login pages and the proxies | the ~60 static files + 8.9 MB per install | OWNER decision (DNS/hosting), see `STEP4_STATIC_EXPORT_INVENTORY_2026-09-22.md` | owner |
| 6 | Rank the ~300 remaining proxies by real use before moving any: the server's `withTiming` lines per route over 48 h with real users | tells which of the 282 proxies carry traffic | owner reads Vercel usage / logs once Vercel is live | owner + small |

After steps 1-4 a daily session is edge-only (Supabase); Vercel carries the login pages, the one-time install and the online-only screens.

## 5. Status of the rows

A1 VERIFIED (plan tier today; owner reads the monthly meters). A2, A3 PARTIAL: measured, guarded, every remaining route named with a reason and a plan; the
moves are steps 1-6. A6 VERIFIED against the stated policy (files only if pinned or recent, caps held in real Chromium); the literal "whole app incl. all files" is
a policy choice the owner already made. A19, A23 VERIFIED on the rig (journey, 0 set-up actions, 7 actions, timings committed); real-network timing belongs to the
live install lane. A21 VERIFIED (measured and budgeted). A22 VERIFIED (zero mail requests over three sign-ins).

## 6. A2 edge proxy (2026-10-05, ai-os/audit37/A2_PROGRESS.md)

The Supabase Edge Function `projexa-api` (compliance-tracker `supabase/functions/projexa-api`) answers the 7 proxy routes the shell reaches
(dashboard / exceptions / BOQ-analysis snapshots, BOQ line PATCH, the three file-signing reads) with the Next handlers' exact contract
(`src/lib/projexa-api-parity.test.ts`, 122 cases; live smoke 24/24 identical). On https://projexa-ai.com the browser calls it through
`src/lib/px-api.ts`; the Next handlers stay as the same-origin fallback. Shell-reachable routes answered by Vercel: 8 -> 1 (the beacon).

BATCH 2 (2026-10-06): the 40 most-used plain proxies of the online screens moved the same way (A2_PROGRESS.md): 47 routes answered by the
edge on the production origins; **Vercel-served /api routes 304 -> 264** (`vercel_served_routes_budget`, may only go down).

Remaining, in order (measured 2026-10-06 on this tree; 311 route files: 282 VERIDIAN proxies of which 47 moved, 17 own logic, 12 Supabase):
1. The other 66 PLAIN proxies (`bun scripts/projexa-api-candidates.mjs` lists them, each with its derived spec): same recipe, batch 3+.
   Each batch: routes json + parity `REQUESTS`, record, regenerate, compliance-tracker PR, DEPLOY, live smoke, THEN the client list here,
   and its direct `fetch()` callers -> `viaPxApi`. Rank by real use first (step 6 above).
2. The generator needs three more spec keys before the rest can move: `root` (20 routes call `/api/v1/*` outside `/projexa`), an
   `error_extra` field list (3 routes forward a named upstream field, e.g. `conflicts[]`), and per-method role sets for the 21 routes with their
   own `requireRole()` beyond the write table.
3. Multi-call / cached proxies (9 with `Promise.all` fan-out, 14 with a cross-request cache): need their composition ported, one by one.
4. Binary / multipart (11: uploads, PDF/xlsx downloads, BOQ import): stream passthrough in the function; the 30 s upload budget.
5. The 17 own-logic and 12 Supabase routes (beacon, shell bootstrap, email/webhooks with server secrets, Google Sheets, AI chat, provisioning):
   stay on Vercel until each has its own reason to move; the beacon could fold into projexa-sync /prepare.
6. Delete a Next handler only when no caller needs the same-origin fallback (kill switch) any more.
