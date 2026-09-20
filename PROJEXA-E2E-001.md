# WORK ORDER · PROJEXA-E2E-001

**All 111 requirements, four surfaces, every role, proven end to end**

To: Claude Code
From: Rajat Agarwal, owner
Issued: 20 Sep 2026
Scope: PROJEXA-AI.COM only. DPDP work pauses until this closes.

> This file did not exist on disk when this work order was issued — the owner pasted
> its full text directly in chat. It is transcribed here verbatim as the durable,
> committed record, per this repo's own convention (a work order referenced by future
> sessions needs a real file, not a chat transcript). Transcribed 2026-09-20 by the
> session that received it. See `ai-os/boss/ACTIVE-CLAIMS.yaml` for this session's
> claim entry and `PROJEXA-E2E-001-PROGRESS.md` for the live findings this order
> produces.

Agreed with Sumeet in a meeting. This is not new scope — most of it is built. This
work order is about proving it works, finding what does not, and filling the gaps.

## 0 · THE PRINCIPLE THAT DECIDES EVERY TEST

The human does no data entry. None.

The software fills everything in. The human decides — approve, reject, edit, upload,
sign off. That is the product. Traditional ERP is a data-entry machine with reports
attached; this is an analysis machine that asks a person to confirm its work.

So the question in every test is not "can the user enter a BOQ". It is: did the user
have to type anything at all?

If a screen requires typing that the software could have derived, inferred from an
upload, or carried from a prior project, that is a failure, even if the screen works
perfectly. Log it as a finding with what the software should have filled in instead.

Owner ruling: in roughly 90% of cases an explicit approve/reject step should not be
needed either. Where the software is confident and the source is clean, it proceeds
and the human is told what happened. Approval is for the exceptions, the money, and
the irreversible. If a flow makes someone click Approve on something obvious, that is
also a finding.

## 1 · WHERE THE DATA COMES FROM

Zero data entry is only real if the data has a source. Four, and all four must work:

| Source | Description |
|---|---|
| Excel / spreadsheets | Upload a BOQ, a rate card, a staff list. Parsed, mapped, validated, loaded. Malformed rows rejected readably; nothing written until the whole file passes |
| Images and documents | Site photographs, scanned invoices, drawings, delivery challans. Read and extracted, not filed and forgotten |
| Free writing | A paragraph typed or dictated, turned into structured records. This is the one place typing is allowed, because the person is describing, not entering |
| Prior data as reference | Previous projects, earlier BOQs, last month's rates. The software proposes from history rather than starting blank |

Both the AI and the human can edit anything afterwards. Every edit records who made it
and when — human or AI, on the same record, with the same visibility.

Test every requirement against at least one real source. A requirement whose only
path to data is a human typing into a form has failed section 0, whatever else it
does.

## 2 · FOUR SURFACES, ALL OF THEM, EVERYWHERE

Owner ruling: every requirement, on all four surfaces. Not "where it fits" — all four.

| # | Surface | Description |
|---|---|---|
| 1 | One page | Everything the AI has done for this project, on a single screen. The human approves, edits, uploads, and is finished |
| 2 | ERP screens | The traditional module-by-module path, every field already filled in. The human moves through and confirms |
| 3 | AI link | A link pasted into ChatGPT, Claude, or any free chat engine, that works on that project for that user |
| 4 | Email | The full workload in an email, completable by reply, exactly as the web page would be |

All four write to the same record. Approve on the web page, and the email reflects
it. Answer by email, and the ERP screen shows it. Test each requirement's state after
being touched by each surface — a divergence between surfaces is the worst class of
bug here, because both look right in isolation.

Where a surface genuinely cannot carry something — a Gantt chart in a chatbot, a
photograph upload by reply — build the nearest honest equivalent and record what you
did. A link out, a summary, a callback. Do not silently skip it and do not pretend it
is there.

## 3 · SCOPE — 111 REQUIREMENTS, EVERY ROLE

- 80 register rows in `platform.sumeet_requirements` (R-01 to R-100)
- 31-item exceptions directive

Every role that exists in the product. A requirement passing for the CEO and failing
for the site engineer has failed.

**Verify the register first.** 14 of the 80 rows cite Playwright tests under `e2e/`
that do not exist in the repo. A requirement closed against a test nobody wrote is
not closed.

Re-open all 14, write the tests, and re-close only what genuinely passes. If the
count drops below 80, report the real number. I would rather have a true 74 than a
false 80 — the false one fails in front of Sumeet.

## 4 · REPORTS, ANALYSIS AND DASHBOARDS CARRY THE MOST WEIGHT

This is what Sumeet judges the product on. Test them hardest.

- Every figure traceable to its source. A number on a dashboard must be provably
  derived, and clicking it should reach what produced it
- No dashes where data exists. The `/reports` Project Status Report currently shows
  dashes against a project with real BOQ and progress figures. That class of bug is
  the worst thing on this list — it says the product cannot see its own data
- Reconcile across surfaces. The same figure on the one-page view, the ERP screen,
  the AI link and the email must match. If they disagree, one of them is lying and we
  do not know which
- Reconcile across roles. Where roles see different numbers, that must be a
  deliberate scoping rule, not an accident
- Empty, partial, and heavy states. A dashboard on a brand-new project, a
  half-finished one, and one with two years of history

## 5 · THE BROKEN SCREENS ALREADY FOUND

From the deck capture. Fix and prove, in this order:

| Screen | Problem |
|---|---|
| `/change-orders` | Shows "No change orders yet" with 2 real ones in the database. Sumeet will click this first |
| `/reports` | Dashes instead of real BOQ and progress figures |
| `/site-diary` | Empty while Work Progress holds the same history |
| `/scope` | Filter and Export marked "Not yet available" |
| `/site-materials` | Silently redirects to `/materials` — decide: real screen, or remove the route |
| `/schedule` | Ignores the project switcher, reads only `?projectId=`. Looks broken unless you know |
| Site Engineer project lock | Auto-locks to "Business Bay Corporate HQ" instead of the seeded project. Tell me plainly: intentional role scoping or a bug? |
| Cold loads 10–20s | `/labour`, `/budgets`, `/reports`, `/knowledge-base`, `/meetings`, `/mood-boards`, `/settings`, `/grc`. Find the cause. This is the single biggest risk to a live demo |

## 6 · WHAT END TO END MEANS HERE

Not unit tests. Not "the service returns the right value."

A real user, on a real surface, completing a real task, with the result visible
everywhere else.

For each requirement:

1. Start from the data source — upload the sheet, the photo, the paragraph
2. Let the software do its work
3. The human approves or edits only where a human genuinely should
4. Confirm the result on the other three surfaces
5. Confirm the report or dashboard that depends on it moved
6. Confirm the record shows who did it and when — human or AI

Real browser, not just Node. Claude in Chrome for the web surfaces. A real email
delivered and replied to for surface 4. A real link pasted into a real chat engine
for surface 3.

## 7 · HOW TO REPORT IT

A table I can read, one row per requirement:

```
REQ    | SURFACES        | ROLES     | DATA IN     | ZERO ENTRY | REPORTS  | STATUS
R-45   | 1 ✓ 2 ✓ 3 ✓ 4 ✓ | all ✓     | excel ✓     | ✓          | ✓        | PASS
R-52   | 1 ✓ 2 ✓ 3 ~ 4 ✗ | CEO only  | manual      | ✗ typing   | dashes   | FAIL
```

Plus:

```
TRUTH
- requirements verified end to end:  <n> of 111
- of the 14 phantom tests:           <n> genuinely close, <n> re-opened
- requirements needing typing:       <list — these fail section 0>
- requirements needing pointless approval: <list — these fail section 0 too>
- surfaces not reachable, and why:   <list>
- figures that disagree between surfaces: <list — the worst findings>
- screens still broken:              <list>
```

Do not mark anything PASS that you have not seen work. A false pass costs more than
an honest fail, because it fails in front of Sumeet instead of in front of me.

## 8 · ORDER

1. Verify the 14 phantom tests. Everything else stands on the register being true
2. Fix the broken screens in §5, starting with `/change-orders`
3. Reports, analysis and dashboards — the heaviest weight, so the earliest real proof
4. Then requirement by requirement, four surfaces, every role
5. The cold-load problem, whenever you find its cause

If you run short, a truthfully verified 60 beats a claimed 111. Tell me where you
stopped.

## 9 · GROUND RULES

- Local for building and testing. Vercel is live only, per the standing ruling
- Nothing marked done without evidence — a file path on `origin/main`, a commit SHA,
  or a query result
- Separate "my tool cannot do this" from "my safety classifier refused this"
- Flag any requirement where you think Sumeet's intent and the built behaviour have
  drifted apart. That is a business question and it comes to me

## 10 · THE TEST THAT MATTERS

Sumeet opens PROJEXA, uploads a spreadsheet and some site photographs, and types
nothing.

The software does the work. He looks at what it produced, changes two things, and
the reports are right.

If that happens, this work order is done.

---

## ADDENDUM — Owner's local-only operating rule for this entire work order (relayed verbatim, 2026-09-20)

> All development, all testing and all verification happens on local + GitHub +
> Supabase. Nothing touches Vercel until everything is green and I have said so.

That means:

- `bun dev` locally for every screen and every surface
- CI on GitHub for the test suites
- The live Supabase database for data
- No preview deploys, no branch deploys, no "just to check"

**Ignored Build Step:** confirm both Vercel projects (`veridian-compliance-ai` and
`projexa`) are set so that only `main` can ever trigger a build:

```
if [ "$VERCEL_ENV" = "production" ]; then exit 1; else exit 0; fi
```

If it isn't set, set it and report the commit. Every feature branch and every PR
should then cost zero credits.

**External reachability** (the AI link pasted into ChatGPT, email links clicked from
a real inbox): use a cloudflared tunnel to the local instance, not a Vercel preview.
Report the tunnel URL and how long it stays up.

**Vercel gets one deployment, at the end**, when everything is green and the owner
has approved it. Not before.
