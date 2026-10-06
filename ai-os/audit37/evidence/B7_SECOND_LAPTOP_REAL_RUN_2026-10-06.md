# AUDIT-100 B7, second-laptop leg: real-backend run (2026-10-06): NOT VERIFIED

Spec: `e2e/audit37-real-b7-writeback.spec.ts` (with `playwright.audit37-real.config.ts`). Rig: a local production build of
origin/main `5b25d795` (includes the #385 fix), built with `next build --webpack` + `scripts/make-release.mjs` and served by `next start`
on :3101. Browser: Microsoft Edge (channel `msedge`), WITHOUT `--disable-web-security`, because :3101 is an allowed origin of the sync
service. Backend: the real projexa-sync service and the real Supabase, with the E2E test org accounts from `e2e/users.ts`.
Sanitized run output: `b7-second-laptop-real-runs-2026-10-06.txt`. Request counts and timings come from the Playwright traces, which are
not committed because they hold the session.

Before each run the backend was checked and was calm. `GET /release/current` answered 3 times in a row in under 1 s. It answers 401
"Sign in again" without credentials, and the client's own connectivity probe counts any non-5xx as up. `select 1` was quick on both
projects.

## Run 1: spec as on main. Failed in `beforeAll`, after 7 min
- Laptop A (finance) and laptop B (ceo) made their first copies AT THE SAME TIME, 1,135 requests in 7 min:
  A made 556 requests (515 `/pull`), B made 579 (529 `/pull`). Together that is about 200 requests a minute.
- From 01:40 UTC, `/pull` answers slowed to 6-15 s. 34 pulls failed on the client, most of them at its 15 s limit. In the same minutes the live DB logged
  statement timeouts (57014) and 10-27 s queries, from both PROJEXA and other traffic. B's copy could not end clean, so it never wrote `sync:last`.
- Test bug (fixed in this PR): the hook ran from 11 s to 432 s, so it was cut at the config's 420 s. Its own 900 s wait never got to run.
  A `beforeAll` does not take the file-level `test.setTimeout(1_500_000)`. Playwright's message ("Test timeout of 1500000ms exceeded")
  hides this.

## The single fix attempt (this PR)
1. `test.setTimeout(1_800_000)` is now set INSIDE `beforeAll`.
2. The first copies now run one after the other: the spec waits for laptop A's `sync:last` before laptop B signs in. That is about
   100 requests a minute instead of 200.

## Run 2: the fix worked for its part. Failed on a live-service outage
- Laptop A finished its WHOLE first copy (`sync:last`) cleanly at 463 s: 710 requests, of which 649 were `/pull` (646 answered
  200, avg 776 ms) and 40 were `/changes`. That is about 100 a minute, as designed.
- Laptop B (ceo) then signed in (01:54:53 UTC), and the sync service stopped answering it. Of B's 28 requests in 5 min, only one `/manifest`,
  one `/prepare` and one `/release/current` (401) got an answer; the rest timed out on the client: 7 of 8 `/manifest`, 5 of 6 `/prepare`, all 3
  `/install`, both `/heads`, and `/attest` after 104 s. B never got its first `sync:done`, so `loginAndPrepare` gave up at 300 s.
- Server side (Supabase logs) for that window: function calls fell from about 300 a minute to 12-26 a minute between 01:55 and 01:58.
  Postgres logged catalog and trivial queries at 11-36 s (`pg_database_size` 36 s, `projexa_release_current` RPC 20 s), BOQ and
  work-progress queries from other clients at 10-35 s, statement and transaction timeouts, and at 01:59 one function call of 150 s.
  The local server's own VERIDIAN calls and Supabase `getClaims()` also timed out. A probe from this laptop at about 01:58 got no
  answer in 10 s.

## Conclusion
B7's second-laptop leg is still NOT VERIFIED against the real backend. No B7 assertion was reached in either run: no RFI was
created, so nothing could arrive on laptop B. Neither run shows a client defect. Run 1's failure was the hook-timeout test bug
(fixed here), plus slowdown while two laptops copied at once. Run 2 failed because the live database was saturated at the moment
laptop B started (about 1/10 of normal throughput, trivial queries at 20-36 s). This matches the open shared-DB overload problem.
The stub-backend proof from #385 (`e2e/lf-lifecycle-live-sync.spec.ts`, seen to fail on the old build) and its unit tests are
unchanged. The next real attempt needs a live DB that stays healthy for about 20 min, with nothing else heavy on it.

## Cleanup
- Neither run created any row: both failed in `beforeAll`, before any write.
- Two leftover RFIs from the 2026-10-05 run of this spec, in the E2E test org, were deleted: `ccl1wte6b6wv42pdrx85e0wb`
  "B7 online RFI audit100-1791217478757" (no. 12) and `gfsp82jw5gic3e0hxwssz571` "B18 offline RFI audit100-1791217478757" (no. 13).
  Re-read afterwards: rows with a subject containing `audit100` = 0. The delete triggers record the removal in the change feed.
