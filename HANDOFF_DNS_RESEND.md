# HANDOFF: Resend domain verification for send.projexa-ai.com / reply.projexa-ai.com

WO-PROJEXA-AI-LINK-001 Part 2 (email-as-interface) is built and code-complete
(`src/lib/email/send.ts`, `digest.ts`, the one-click action token routes) but
cannot send real mail from `send.projexa-ai.com` yet, because that subdomain
is not verified with Resend. This is not a code gap -- it is a genuine,
structural step that only a human with dashboard-login access can do. Full
reasoning below, so this isn't just an assertion.

## Why no AI agent can do this step

I have Vercel project-management tools (list/get project, domains) but
**no tool anywhere in this environment can read, add, or verify DNS records
for an already-owned domain** -- the only domain-related Vercel tools
available are for *buying a brand-new domain*, not editing records on one
you already own.

Separately, and just as decisive: Resend's own API is **sending-only** by
design (confirmed independently by a different Claude session working the
identical problem for the sibling `veridian-aios.com` domain today, logged
in that repo's own `HANDOFF_FOR_RAJAT.md`, Item 5 -- their `RESEND_API_KEY`
was refused with *"This API key is restricted to only send emails"* the
moment it tried to read/manage domains). Resend deliberately does not expose
"add a domain and hand back its DKIM records" over the sending API -- you
have to be logged into the Resend dashboard as a human to see the exact
records it generates. There is no way to predict or fabricate them in
advance.

So this step needs you (or whoever has projexa-ai.com's registrar/DNS
access) directly, once, in a browser.

## What to actually do, in order

**At the Resend dashboard (resend.com):**
1. Log in -> **Domains** -> **Add Domain** -> type `send.projexa-ai.com`.
2. Resend shows a table of DNS records (usually 3 CNAME rows for DKIM,
   sometimes a TXT row for SPF). These are generated fresh per-account --
   copy the exact values Resend shows you, not any example from elsewhere.
3. Add each record exactly as shown, wherever `projexa-ai.com`'s DNS is
   managed today (your registrar, or Vercel if projexa-ai.com's nameservers
   point there -- Vercel's own dashboard has a Domains -> DNS Records screen
   for this if so).
4. Click **Verify** in Resend. What you should see: status changes from
   "Pending" to "Verified."

**Subdomain split -- do not put everything on one name:**

| Subdomain | What it's for | Where it's configured |
|---|---|---|
| `projexa-ai.com` (bare domain) | Whatever mail you already use today | **Don't touch** -- leave its existing MX/mail records alone |
| `send.projexa-ai.com` | Every automated email this app sends (digests, one-click action links) | Resend (step above) |
| `reply.projexa-ai.com` | Inbound replies, if/when that's built | Not needed yet -- see below |

**`reply.projexa-ai.com` (inbound replies): nothing to do yet.** The code
(`REPLY_DOMAIN` in `src/lib/email/send.ts`) already sets `Reply-To` to this
domain so it's ready the moment an inbound handler exists, but no inbound
webhook/route has been built in this pass -- there is nothing on the
PROJEXA side yet for a reply to land on. Treat this as a real, separate,
not-yet-started item, not a DNS record to add today.

## Once verified

Tell whoever's driving the next PROJEXA session that `send.projexa-ai.com`
shows "Verified" in Resend, and set `RESEND_API_KEY` in Vercel's project env
vars (Production + Preview) if it isn't already there -- `sendEmail()` in
`src/lib/email/send.ts` no-ops with a `console.warn` when that variable is
absent, by design, so nothing breaks or silently fails today; it just
doesn't send. A real test-digest send (`POST /api/email/send-digest` while
signed in) is the fastest way to confirm delivery end to end once both the
DNS verification and the API key are in place.

## What's confirmed working right now, without any of the above

Everything upstream of actually dispatching the email: token issuance
(`issueEmailActionToken`), the one-click action route
(`/api/email/[token]`, verified live against the real Supabase project --
mint, click, applied, re-click refused as already-used, cross-org token
rejected by the database trigger), and digest composition
(`sendDigestForMembership`). The only missing piece is the outbound send
itself, which needs the DNS verification above.
