# PROGRESS -- task-20260727-122821-projexa-e2e--pwa-offline-sync---real-tas

## Completed
- [x] Phase 0 investigation confirmed (per SPEC KNOWN_CONTEXT): PWA infra absent, offline/IndexedDB absent, dependency-blocking absent in compliance-tracker's pms-issue-service.ts
- [x] Checked ai-os/boss/ACTIVE-CLAIMS.yaml in both repos, no real conflicting active claims found
- [x] Claimed scope in PROJEXA's ACTIVE-CLAIMS.yaml
- [x] Cloned compliance-tracker fresh into a dedicated task workspace (repo dir /opt/veridian/repos/compliance-tracker was dirty with unrelated in-flight sessions -- avoided editing it directly)
- [x] Claimed scope in compliance-tracker's ACTIVE-CLAIMS.yaml (branch feat/pms-dependency-blocking-enforcement), pushed
- [x] compliance-tracker: pms-issue-service.ts -- updateIssue() now checks pmsIssueRelations before allowing a transition into a "completed"-group status (rejects with a specific 409 ServiceError naming the incomplete predecessor); addIssueRelation() rejects a new blocks/blocked_by edge that would immediately leave an already-completed successor with an incomplete predecessor. No-relation issues (the common case) are untouched. Pure edge-normalization logic extracted as exported `predecessorIdsOf()`.
- [x] compliance-tracker: src/lib/services/pms-issue-service.test.ts -- 7 bun:test cases for predecessorIdsOf() (matches this repo's existing convention of testing pure logic, not withTenantContext/live DB, in .test.ts files -- no test-DB harness exists in this environment). `bun test` passes (7/7), `npx tsc --noEmit` clean (needed NODE_OPTIONS=--max-old-space-size=6144 -- default heap OOMs on this repo's full project graph).
- [x] PROJEXA: src/app/manifest.ts -- Next.js native manifest route, adapted from compliance-tracker's real working manifest.ts (same mechanism), PROJEXA's own branding/colors (verified against globals.css's real --background/--foreground tokens), no share_target (that's VERI Chat-specific, doesn't apply to PROJEXA).
- [x] PROJEXA: public/sw.js -- hand-written service worker (justification in the file's own header comment: no next-pwa/workbox dependency exists in this repo today, and a small first-party SW matches this codebase's general convention over adopting a heavy build-plugin). Network-first navigations with app-shell cache fallback, cache-first for static GETs, explicitly bypasses /api/* (offline queue's job, not the SW's -- avoids silently serving stale org/project data). Registered from src/components/ServiceWorkerRegister.tsx, mounted in src/app/layout.tsx.
- [x] PROJEXA: src/lib/offline/work-progress-queue.ts -- idb-keyval-backed (added as a new dependency, confirmed not already present anywhere in the monorepo) local queue for work-progress entries (quantity/percent/remarks/photo Blob). "Always queue, sync opportunistically" design: every submission enqueues first, then syncs immediately if online; an `online` event listener drains the queue on reconnect. Wired into src/components/WorkProgressClient.tsx with a real, visible amber "N entries queued, will sync" panel (not silent), a manual "Sync now" button, and a photo file input on the Log Progress dialog.
  - KNOWN, DISCLOSED GAP: photo blobs are captured and queued locally for real, but are NOT uploaded on sync. compliance-tracker's real `constructionWorkProgressEntries` table has no photo/attachment column, and PROJEXA has zero file-upload API reachable from the client today (confirmed absent -- grepped both repos). Building real cloud photo storage is out of this task's declared 2-PR scope (SPEC's own EXPECTED_OUTPUT limits the compliance-tracker PR to dependency-blocking enforcement). Quantity/percent/remarks sync for real to the real API; the queued-entry UI shows a photo as attached locally, not silently claimed as synced. Flagged here as a real follow-up, not silently dropped.
- [x] `npx tsc --noEmit` clean on PROJEXA (also needed the increased heap).
- [x] PROJEXA: e2e/offline-work-progress-sync.spec.ts written (real Playwright spec: context.setOffline(true), log progress, assert the real "queued, will sync" panel + queue-item content, assert nothing landed server-side yet; context.setOffline(false), assert the queue drains via the real `online` listener, reload, assert the entry now appears in the real entries table). **NOT executed against the live site**: confirmed via a direct `curl https://projexa-ai.com/login` during this task that it still serves compliance-tracker's own login UI, not PROJEXA's (the exact pre-existing prod routing bug the immediately-prior PR (8cf5cab) already documented and was blocked by) -- auth.setup.ts's real login flow can't complete for ANY spec in this suite right now, not something specific to this feature. No local dev server alternative either: this checkout has no NEXT_PUBLIC_SUPABASE_URL/ANON_KEY env vars, so `next dev` can't authenticate locally.
- [x] PROJEXA: src/lib/offline/work-progress-queue.test.ts -- real substitute proof (same honest-substitution pattern as 8cf5cab), exercising the ACTUAL production work-progress-queue.ts module against a real IndexedDB (fake-indexeddb, added as a new devDependency -- this is real browser-local storage, not a "live backend", so it's a different case from this repo's live-DB-test exclusion convention). 5 tests: enqueue persists a real record; sync-while-offline leaves it queued with status 'error' (not silently dropped); sync-once-reconnected POSTs the real payload shape to /api/work-progress and empties the queue; a previously-failed entry retries and lands on the next sync; a real photo Blob round-trips through IndexedDB. `bun test src` -- 26/26 pass repo-wide (note: bare `bun test` also picks up e2e/*.spec.ts and fails on all of them with a pre-existing, unrelated Playwright/bun-test harness conflict -- confirmed this predates this task's changes; `bun test src` is the correct unit-test scope).

- [x] PWA manifest validity check: `bun run build` succeeded for real (production build), `/manifest.webmanifest` compiled as a static route. Started the real built server (`bun run start`, dummy Supabase env vars only to get past middleware's client-construction guard -- the manifest route itself needs no auth) and curled it for real: `GET /manifest.webmanifest` -> HTTP 200, valid JSON with all Web-App-Manifest installability fields present (name, short_name, start_url, display:"standalone", theme_color, background_color, icons with real sizes/type) matching the real logo-mark.svg in public/; `GET /sw.js` -> HTTP 200. A full Lighthouse CLI PWA-category run was attempted (`npx lighthouse ... --only-audits=installable-manifest,service-worker,...`) but did not complete cleanly in this headless/sandboxed environment (Chrome launch friction) within remaining budget -- the curl-verified real 200s + valid manifest JSON + successful production build are the executed, real verification; full Lighthouse automation is a disclosed gap, not claimed as done.

## Remaining
- [ ] Open PRs against both repos through normal dispatch/review pipeline (no direct push to main)

---

# PROGRESS -- task-20260727-131349-fix-pr-54-audit-findings--per-user-offli

Follow-up task: PR #54's supervisor audit (`gh api repos/FChecklist/projexa/issues/54/comments`,
last comment) came back `AUDIT: FAIL`, medium severity, 2 blocking findings
on `src/lib/offline/work-progress-queue.ts` above. Fixing on this same
branch/PR per the audit's "Corrective Action Owner: Worker" instruction.

## Completed
- [x] Read full audit verdict -- 2 real blocking findings (cross-user data
      leak on shared devices; sync race condition), 1 non-blocking follow-up
      (no backoff/max-attempt cap on permanently-failing entries).
- [x] Finding #1 (cross-user leak, the primary blocker): every
      `work-progress-queue.ts` function now takes an explicit `scope` param
      (the signed-in user's Supabase auth id) and reads/writes a per-scope
      IndexedDB store -- no unscoped fallback exists. `WorkProgressClient.tsx`
      resolves `scope` via `createClient().auth.getUser()` on mount and gates
      every queue read/write on it being resolved (an unresolved scope means
      "don't know whose queue this is", not "fall back to a shared one").
- [x] Finding #2 (sync race): added a real mutex to
      `syncQueuedWorkProgressEntries()` -- overlapping calls for the same
      scope now dedupe onto a single in-flight drain promise (the lock is
      set synchronously before the drain's first `await`, so there's no
      window for a second concurrent call to start its own drain loop).
- [x] New tests in `work-progress-queue.test.ts`:
      - cross-user isolation (2 tests): a second scope can't see or drain a
        first scope's queued entries; the first scope's entry is untouched
        (still `pending`, not deleted) after the second scope's sync runs.
      - concurrent-sync dedupe (2 tests): two overlapping sync calls for the
        same scope produce exactly one POST; the lock releases correctly so
        a later, non-overlapping call still runs.
- [x] `npx tsc --noEmit` clean.
- [x] `bun test src`: 30/30 pass (bare `bun test` also picks up Playwright
      e2e specs and fails on all of them -- that's the same pre-existing,
      unrelated bun-test/Playwright harness conflict noted above, not
      something this task introduced; `bun test src` is this repo's
      established real unit-test scope).
- [x] Committed + pushed directly to `feat/pwa-offline-infra` (same PR #54,
      no new PR opened): commit b5014d9.
- [x] Time-permitting follow-up (non-blocking per audit): added a
      `MAX_SYNC_ATTEMPTS = 5` cap. An entry that fails 5 sync attempts in a
      row (e.g. a real 4xx because its activityId was deleted server-side)
      is marked terminal `status: "failed"` and permanently excluded from
      the automatic retry loop -- it no longer burns every future `online`
      event retrying something that can't succeed. UI badge distinguishes
      "will retry" (`error`, < 5 attempts) from "sync failed, won't retry"
      (`failed`, capped). New test proves the 6th sync call makes no
      further fetch call. `npx tsc --noEmit` clean, `bun test src` 31/31.

## Remaining
- [ ] Fresh supervisor audit required before merge (per this repo's review
      pipeline) -- not performed by this task; do not merge PR #54 directly.

## Constraints honored
- Did not touch `src/app/manifest.ts`, `public/sw.js`,
  `src/components/ServiceWorkerRegister.tsx` (audit already confirmed these
  correct).
- Did not touch any cron/systemd `.timer` state.
