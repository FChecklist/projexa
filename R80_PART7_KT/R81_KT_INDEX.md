# R81 knowledge-transfer pack

Written 2026-09-08 by the R81 session. Everything here is derived from the live
database and from source at ct `b110f436` / projexa `4c5f7240`. Where a figure
here disagrees with an older document, this one is the correction and says why.

## The one number people will quote, and why it is wrong

**Defensible CLOSED is 42, not 51.**

- **51** is what `platform.sumeet_requirements` stored before R81.
- **45** after removing six closures — R-01, R-02, R-32, R-40, R-B1, R-B2 — which
  all cite `ct/e2e/demo-gate-smoke.spec.ts`. That spec does not pass in CI on main.
  It clears all four existing citation-gate checks only because **the gate never
  looks at CI outcome**. Binding ruling `R81-RULING-03`.
- **42** after K5-02 reopened three more (R-50, R-C11, R-C15) as over-credited.

Stored state is now CLOSED 48 / BLOCKED 13 / NOT_TESTABLE 5 / OPEN 4 = 70.
42 is that 48 minus the six CI-red closures. The six are deliberately *not*
reverted here — that revert belongs to Addendum B G2-02.

## The ledger under-credits more often than it over-credits

An independent audit re-derived all 70 requirements from source, told to ignore
the stored verdict. It disputed 20 rows. Twelve of the thirteen **BLOCKED**
requirements are **fully built in current source** (R-11, R-15, R-30, R-31,
R-41, R-42, R-43, R-60, R-80, R-81, R-82, R-90). BLOCKED appears to have been
recorded from runs against the **paused Vercel deployment** — measuring the
environment, not the product.

They are **not** promoted to CLOSED here. `R81-RULING-03` binds in both
directions: source-reading is not a passing test. Promoting them would be the
same error as the six CI-red closures, pointing the other way. The route to
closure is one spec each, bound to environment 1, green in CI. Gap G-20.

## Files in this pack

| File | What it is |
|---|---|
| `R81_REQUIREMENTS_70.csv` | All 70 requirements, current closure state, cited test. Row counts cross-checked against the database (13/48/5/4). |
| `R81_GAP_ANALYSIS.csv` | 20 gaps, 9 blocking launch. Each carries what is missing and *why it matters*, not just a label. |
| `../../ct/docs/R81_CHANGE_DOCUMENT.md` | 16 changes C-01..C-16 with file, requirement served, dependency, test, surface and falsifiability. |

Full text (intent what/why/where/when, verdict evidence, discard reasoning)
lives in `platform.r81_gap`. Faults are in `platform.r43_faults` (`R81_%`).
Narrative decisions are in `platform.claude_log` — see id 326 for this pass.

## Two things that need the owner, not an engineer

1. **G-19 / R-50.** The requirement says project value must match the BOQ total.
   `construction-dashboard-service.ts:159-163` records a standing owner ruling
   that `projectValue` must **deliberately not** fall back to the BOQ. Both
   cannot be true. **This must not be "fixed" in code** — reconciling them
   reintroduces the R67 D-62 "three money stories" defect the ruling exists to
   prevent. Withdraw the requirement, or overturn the ruling.
2. **G-01 / the AI layer.** `adapter.ts:80` states that Claude Code subscription
   auth may not serve a request on behalf of another person. That contradicts the
   ruled end-user default. It is a licensing/design fault, **not** a
   misconfiguration — filing it as config leads someone to "fix" it by setting
   `AI_PROVIDER=claude-cli`, which is the exact action the guard prevents.

## Traps that cost this session real time — read before touching the database

- **A zero-row query here usually means RLS, not missing data.** `DATABASE_URL`
  in `.env.local` connects as **`app_runtime`**, and ~600 of 602 tables in
  `compliance`/`platform` deny it. A CSV export of `platform.r43_faults` returned
  0 rows and nearly shipped as an empty artifact; the table holds 223. Read
  registry tables through the Supabase MCP (service_role), never that connection.
- **There are TWO migration ledgers and they do not reconcile.**
  `drizzle/meta/_journal.json` + `drizzle.__drizzle_migrations` is what
  `bun db:migrate` and the CI replay harness read. `supabase_migrations.schema_migrations`
  is what the Supabase `apply_migration` path writes, and **nothing in the repo
  reads it**. DDL applied that way is live *and* invisible to every mechanism
  that builds a fresh database — the replay job stays green because it never
  looks at the file. `scripts/check-migration-journal-parity.mjs` now fails CI on
  any new orphan. Faults R81_F37 / R81_F38.
- **`CREATE POLICY` has no `IF NOT EXISTS`**, and neither does `ADD CONSTRAINT`.
  Use `DROP POLICY IF EXISTS` first or the migration breaks replay.
- **New `platform` tables must carry the house RLS shape** — RLS enabled plus one
  `service_role_bypass_<table>` policy. Two tables were missing it and were
  readable *and writable* by the application role. Fault R81_F39, fixed in
  `drizzle/0573`.
