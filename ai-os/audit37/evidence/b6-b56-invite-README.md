# AUDIT-100 B6 + B56 evidence (2026-10-05)

Spec: `e2e/audit37-real-b6-b56-invite.spec.ts` (run with `playwright.audit37-real.config.ts`; needs the PROJEXA project's
`SUPABASE_SERVICE_ROLE_KEY` in the test process environment, so it is NOT in any CI config).

Real local production build (`next build --webpack` + `scripts/make-release.mjs`, `next start`), real PROJEXA Supabase project
(evpckeuxgvahguwsaeul), real Chromium. Nothing stubbed.

| File | Build | Result |
|---|---|---|
| `b6-b56-invite-1-before-fix-main-build-FAILS.txt` | main before this PR (:3100) | FAILS: after signing in from the invitation the invitee lands on `/dashboard`, not back on `/invite/<token>` (the sign-in form ignored `?redirectTo`) |
| `b6-b56-invite-3-token-handoff-broken-FAILS.txt` | this PR, compiled accept route patched so the token handed to `accept_org_invite` is reversed (:3102) | FAILS: accepting never reaches `/dashboard`; nothing attached |
| `b6-b56-invite-2-after-fix-PASSES.txt` | this PR, compiled route restored byte-identical (`cmp`) (:3102) | 4/4 pass |

What the passing run proves (each by re-reading the database or the browser's own storage, not a message):
1. An org owner creates an invitation in Settings (OrgInvitesCard) with role `pm`: one open `org_invites` row, role `pm`.
2. A brand-new account with NO organisation opens `/invite/<token>` signed out, is sent to sign in, comes back to the invitation,
   accepts: `memberships` = exactly `[{organization_id: <test org>, role: "pm"}]`, invitation `accepted_by` = that account.
   The install starts: "Preparing your PROJEXA workspace" screen, an active service worker, and `projexa-local:<userId>` IndexedDB.
3. The used link: "This invitation is no longer open", POST accept -> 400 "This invitation has already been used.", membership unchanged.
4. A wrong link: "This invitation link is not valid." (page and POST 404); an expired link: "no longer open", POST 400
   "This invitation has expired. ..."; the stranger account has zero memberships, the expired invitation is not accepted.

Cleanup (every run, in afterAll, re-read): the test organisation (cascade: memberships, org_invites), the throwaway accounts'
`security_audit_log` rows, and the three auth users (cascade: profiles). Independent check after all runs:
auth.users / profiles / organizations / org_invites / security_audit_log rows matching this spec's names = 0 / 0 / 0 / 0 / 0.
