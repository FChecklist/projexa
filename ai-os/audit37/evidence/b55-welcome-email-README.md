# AUDIT-100 B55 evidence (2026-10-06): the invite welcome e-mail carries a personalised AI prompt

Spec: `e2e/audit37-real-b55-welcome-email.spec.ts` (run with `playwright.audit37-real.config.ts` on Microsoft Edge; needs the PROJEXA
project's `SUPABASE_SERVICE_ROLE_KEY`, a Supabase `SUPABASE_ACCESS_TOKEN` and `RESEND_API_KEY` in the test process, and the server needs
`RESEND_API_KEY` to send, so it is NOT in any CI config). No token, link, key or e-mail address appears in these files.

Real local production build of this branch (`next build --webpack` + `scripts/make-release.mjs`, `next start` on :3155), real PROJEXA
Supabase project (evpckeuxgvahguwsaeul), the real `ai-work-link` Edge Function and database on VERIDIAN (pcrjmlpuqsbocqfwoxod), the real
Resend account (verified domain send.veridian-aios.com). Nothing stubbed.

| File | What | Result |
|---|---|---|
| `b55-welcome-email-0-unit-planted-bugs-FAIL.txt` | two bugs planted: the link put in an href; the e-mail sent before the accept's error check | 7 unit tests FAIL; restored -> all pass |
| `b55-welcome-email-1-rehearsal-no-email.txt` | `B55_DRY=1`: server WITHOUT `RESEND_API_KEY`, no e-mail | 3 pass, the Resend test skipped; cleanup 0 left |
| `b55-welcome-email-2-real-run-ONE-email.txt` | the real run: exactly ONE real e-mail | tests 1-3 pass and test 4's assertions pass; the afterAll cleanup then failed on one row (see Cleanup) -- fixed in the spec, re-proven by the rehearsal above |

What the real run proves (each by re-reading the database, Resend or the link itself, not a message):
1. A throwaway org owner creates an invitation (role `client_viewer`) through the real route; the `org_invites` row is re-read.
2. The invitee (a throwaway account on a Gmail plus-address of the owner) signs in from the invitation and accepts it in the browser:
   membership `client_viewer` re-read; exactly ONE `platform.user_ai_links` row for the person: scope `user`, label `Welcome email`,
   authority level 0 (read only: the mint chose it from the role, the request sent no level), 24 hours, active.
3. Resend `GET /emails`: exactly ONE e-mail to the address, from `PROJEXA <noreply@send.veridian-aios.com>`, `last_event=delivered`
   (id 01a10dcb-fe78-7425-aba4-bba3c2a64d17). `GET /emails/<id>`: the html and text parts hold the owner-approved prompt followed by the
   link in the plain-text box; NO href contains the link or a token (the only href is https://projexa-ai.com); the expiry ("It stops
   working in 24 hours ...") and the read-only sentence are present. sha256 of the e-mailed token == the row's `token_hash`.
4. ONE plain GET of the e-mailed link: 200 `text/plain; charset=utf-8`, the 31,939-character guide, which says "level 0 (read only)".
   Then the row was revoked (re-read: revoked) and a GET answered 410.
5. Accepting the same invitation again: 400 "This invitation has already been used.", still ONE link row, and 20 s later still ONE
   e-mail to the address in Resend. Independent check afterwards: one e-mail to any pxwelcome plus-address in Resend; server log line
   `[invite-welcome] sent (e-mail <id>, link <id>, level 0)`; `pxa_` appears in no log.

Not covered by this run: the same e-mail for a role with level 1 (member and above). Covered by unit tests only
(`src/lib/email/invite-welcome.test.ts`), because the task allowed exactly one real e-mail.

## The invitee's VERIDIAN user is a FIXTURE -- read this before calling B55 done for real customers

The link service resolves a PROJEXA session to an active `compliance.users` row (`public.projexa_read_resolve_user`, by `auth_user_id`,
e-mail fallback off). Nothing creates that row for an INVITED person: only an organisation's FIRST user is self-healed
(compliance-tracker drizzle/0675, `ai-work-link/first-user.ts`). A sample of live PROJEXA memberships in linked organisations (10 pm /
site_engineer / client_viewer members) found only 3 with a VERIDIAN user (provisioned by scripts). For every other invitee the mint answers
403 USER_NOT_LINKED, so the welcome e-mail is skipped (logged, the accept still succeeds) -- and the in-app "Copy AI prompt" fails the same
way. The spec therefore creates a throwaway VERIDIAN organisation + `client_viewer` user for the invitee, exactly the state a provisioned
member is in. Linking invited members to a VERIDIAN user is an identity/authorisation change (who may mint, with which VERIDIAN role) and
was not made under this row.

## Cleanup (re-read)

PROJEXA: auth users / profiles / memberships / organizations / org_invites / security_audit_log of the run = 0 / 0 / 0 / 0 / 0 / 0.
VERIDIAN: compliance.organisations / compliance.users of the run = 0 / 0. One row is KEPT on purpose: the used link (revoked, holding only
the sha256 of its token) and its one `platform.ai_work_link_call` row -- the call log is append-only (its guard trigger refuses deletes)
and was not routed around. The real run's afterAll failed on exactly that delete; the spec now revokes every link, deletes unused ones and
reports used ones as retained (proven in the rehearsal: `left behind ... "veridian":0`). The one test e-mail is in the owner's Gmail
inbox (not opened by this run; it was read through the Resend API).
