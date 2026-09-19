# HANDOFF: Postmark Inbound for reply.projexa-ai.com + go-live checklist for the daily digest

The org-configurable start-of-day/end-of-day digest (Owner directive
2026-09-19) is code-complete and locally/Supabase-verified: schema
(`drizzle/0025_org_email_digest_schedule.sql`), the schedule engine
(`src/lib/email/schedule-service.ts`, `src/lib/email/digest.ts`), the
Settings UI card, and the reply-by-email parsing/dispatch path
(`src/lib/email/reply-parser.ts`, `src/lib/services/digest-item-dispatcher.ts`,
`src/app/api/email/inbound/route.ts`). Three things need you, once, before
any of this actually sends or receives real mail. None of them were
attempted by this session -- they're real dashboard/DNS/account actions
outside any AI agent's tool reach here, the same class of step
`HANDOFF_DNS_RESEND.md` already documents for outbound send.

## 1. Outbound send (if not already done)

Unchanged from `HANDOFF_DNS_RESEND.md` -- `send.projexa-ai.com` still needs
to be verified in Resend and `RESEND_API_KEY` set in Vercel's project env
vars. If that's already done, skip this section. Everything below assumes
outbound send works; inbound reply-parsing is a genuinely separate piece
that doesn't depend on it (a digest can send with reply-by-email links even
before Resend is verified -- it just won't arrive until it is).

## 2. Inbound reply parsing: Postmark

Resend cannot receive mail (confirmed in `HANDOFF_DNS_RESEND.md` and
independently by the sibling `veridian-aios.com` project) -- inbound needs
a second provider. Recommendation: **Postmark Inbound**.

**At the Postmark dashboard (postmarkapp.com):**
1. Create a Postmark account/server if you don't have one for this project.
2. Under that server, add an **Inbound** stream (or use the default one).
3. Postmark shows an inbound MX target, typically `inbound.postmarkapp.com`.
   Add an MX record for `reply.projexa-ai.com` pointing there, wherever
   `projexa-ai.com`'s DNS is managed (Vercel's Domains -> DNS Records screen
   if it's hosted there, same as the Resend records).
4. In that inbound stream's settings, set the **webhook URL** to:
   `https://<your-projexa-app-domain>/api/email/inbound`
5. Add HTTP Basic Auth credentials to that same webhook URL field (Postmark
   supports `https://user:pass@yourapp.com/api/email/inbound` directly in
   the webhook URL, or a separate auth header field depending on your
   Postmark plan/UI version -- either way, the two values must match what
   you set in step 6).
6. In Vercel's project env vars (Production + Preview), set:
   - `POSTMARK_INBOUND_USERNAME`
   - `POSTMARK_INBOUND_PASSWORD`
   (any values you choose -- these are checked by
   `src/app/api/email/inbound/route.ts`'s `isAuthorized()`, which fails
   closed if either is unset.)
7. Send a real test email to an address at `reply.projexa-ai.com` and
   confirm it reaches the webhook (Postmark's dashboard shows recent
   inbound activity/attempts, including any non-200 response) -- the fastest
   full loop test is to trigger a real digest first (see step 3 below) and
   reply to the email you receive.

**What this deliberately does NOT touch:** `projexa-ai.com`'s own existing
mail (whatever inbox `hello@projexa-ai.com` etc. already deliver to) --
only the `reply.` subdomain gets a new MX record. Same domain-split
discipline `HANDOFF_DNS_RESEND.md` already established for `send.`.

## 3. The scheduler poll

`.github/workflows/email-digest-poll.yml` (new, `*/15 * * * *`) needs two
GitHub repo settings before it can do anything:
- Repo **variable** `PROJEXA_APP_URL` -- your deployed app's origin, e.g.
  `https://projexa-ai.com`.
- Repo **secret** `EMAIL_DIGEST_CRON_SECRET` -- must be the SAME value as
  the `CRON_SECRET` env var already set on the deployed app (the existing
  `vercel.json` cron entry already depends on that same env var existing).

Set both via `gh variable set PROJEXA_APP_URL --body "https://..." --repo
FChecklist/projexa` / `gh secret set EMAIL_DIGEST_CRON_SECRET --repo
FChecklist/projexa`, or the repo Settings -> Secrets and variables UI.
Until both are set, the workflow fails loudly (its own `curl -f` check) on
every scheduled run rather than silently doing nothing -- check the
Actions tab if digests aren't going out on schedule.

You do not need a paid Vercel plan for this -- the existing `vercel.json`
daily cron entry (08:00 UTC) can stay exactly as it is; it's now just one
more redundant, harmless trigger of the same idempotent endpoint the
GitHub Actions poller calls.

## 4. Once all three are done

- A member sets their org's schedule from Settings -> Daily Digest (owner/
  admin only to edit; everyone can see it).
- At the configured local time, everyone in that org gets an email listing
  what's open, numbered.
- They can tap a link (todos only, the original one-click mechanism) or
  just reply in plain text -- "1 done", "2 answer: use grade-40 rebar",
  "3 blocked, waiting on material" -- and PROJEXA applies it, with an
  acknowledgement email confirming what happened.
- Anything the reply doesn't match to a known numbered item becomes a
  report note, visible to the org (currently via `daily_report_note` rows
  -- a dedicated admin-facing view for these is real, separate follow-up
  work, not yet built).

## Known limitations, stated honestly (see the plan / PR description for the full list)

- Change-order actions and billing-milestone `invoice` aren't reply-able
  (need structured payloads unsafe to free-text-parse) -- shown read-only.
- "Assigned to me" doesn't exist for RFIs/submittals/punch-list today (no
  real assignee field on those entities) -- the digest shows org/project-
  wide open items, not a true per-person filter.
- Sender verification is a From-address match against the replying
  membership's own profile email, not DKIM/SPF verification of the
  inbound message itself -- a real hardening item, not blocking Phase 1.
- Reply parsing is deterministic (numbered items + a fixed keyword
  vocabulary per entity type), not AI-assisted -- deliberate, see the
  plan's reasoning (a probabilistic interpretation of a reply shouldn't
  silently mutate real construction/financial data).
