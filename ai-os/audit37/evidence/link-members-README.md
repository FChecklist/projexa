# AUDIT-100 link-invited-members evidence (2026-10-06): every invited member gets their own VERIDIAN user

Gap (measured by the B55 agent, #397): only an organisation's FIRST person was linked to a VERIDIAN user (`compliance.users.auth_user_id` = their
PROJEXA sign-in). Every invited member's AI work link mint, in-app "Copy AI prompt" and welcome e-mail failed with `403 USER_NOT_LINKED`.

Fix (two PRs):
- compliance-tracker #2088 (merged `49eff0a5`): `drizzle/0728` `public.projexa_ensure_member_user` + `public.projexa_member_veridian_role`
  (applied live), and `projexa-api` `POST /link-member` (`member-link.ts`; deployed from a clean checkout of main, live smoke 24/24 identical).
- projexa (this PR): the accept route links the new member once (fail-soft, 8 s budget) before the welcome e-mail; the AI work link client heals
  `USER_NOT_LINKED` once per call (members who joined before the fix); `scripts/ops/link-unlinked-members.mjs` (dry-run-first backfill).

Role mapping (SQL is the authority; copies in `member-link.ts` and the backfill are unit-tested equal):

| PROJEXA | VERIDIAN | rank / AI link level |
|---|---|---|
| owner, admin | admin | 5 / 1 |
| pm | manager | 3 / 1 |
| site_engineer, member | member | 2 / 1 |
| client_viewer | client_viewer | 1 / 0 (read only) |
| anything else | refused | - |

| File | What | Result |
|---|---|---|
| `link-members-0-unit-planted-bugs-FAIL.txt` | planted: pm -> admin; double-create; accept links twice; no budget on a hanging link; unbounded heal | each FAILS; restored -> all pass |
| `link-members-1-real-e2e-PASS.txt` | `e2e/audit37-real-invite-links-members.spec.ts`, real backend | 9 passed; cleanup 0 left |
| `link-members-2-backfill-dry-run-and-apply.txt` | the backfill dry run on live data, then `--apply` (test orgs only) | see below |

What the real run proves (each by re-reading the database): three invitees (pm, site_engineer, client_viewer) accepted in the browser and each got
exactly ONE VERIDIAN user in the org's VERIDIAN organisation with role manager / member / client_viewer; the welcome mint then succeeded at level
1 / 1 / 0; pm and site_engineer clicked the real "AI prompt" button and got one active level-1 user link; the client_viewer sees the role note,
their own session mints a level-0 link and a write through it is refused (403 `FUNCTION_NOT_ON_LINK`, write_count 0, no intent, no project); a
member who joined BEFORE the fix (membership only) was healed by the first click (VERIDIAN user, role member, level-1 link); `/link-member`
called twice more per person answered `already_linked` and wrote nothing; a second accept was refused and added nothing.

Run notes: Microsoft Edge (Playwright's bundled Chromium cannot launch here) with `--disable-web-security`, because the Edge Functions allow only
`http://localhost:3100` among local origins and that port was held by another session; only the browser's CORS check was lifted. Server without
`RESEND_API_KEY`: no e-mail was sent. Not run: the same spec against a pre-fix build (the pre-fix failure is the B55 measurement and the
"legacy member" step, which starts unlinked); the unit tests are the seen-to-fail proof.

Cleanup (re-read): PROJEXA organizations / veridian_credentials / profiles / memberships = 0; VERIDIAN organisations + users + api_keys + active
links = 0. One revoked link row is kept on purpose: the client_viewer's link that was USED for the refused write has an append-only call-log row
(the guard trigger refuses deletes; not routed around), so it is revoked and kept (holds only the token's sha256).

Backfill dry run (live): 110 memberships; 11 linked; 99 unlinked (22 in test orgs, 77 in others). Of the 99: 4 can be created now (Meridian
Interiors LLC 3, Cobalt Fitout FZE 1; real-looking orgs, left to heal themselves on their first AI-link use, as the script never applies to
them); 10 have no VERIDIAN organisation (Demo Organization 9, R48 Retest 1); 85 have a VERIDIAN user with their e-mail in the same organisation
that is ALREADY LINKED TO ANOTHER SIGN-IN (verified: those auth ids are VERIDIAN-project logins). Those rows are never re-pointed (that would
break the person's VERIDIAN-app sign-in); serving them needs the gateway's e-mail fallback (drizzle/0618, owner question OQ-15, currently off)
or a second identity column: an owner decision, not made here. `--apply` on the test orgs sent 22 members: 13 `email_taken` (that case), 9
`not_eligible` (no VERIDIAN org); 0 rows written.
