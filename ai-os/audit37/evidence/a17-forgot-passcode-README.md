# AUDIT-100 A17 (+ A18) evidence (2026-10-05)

Spec: `e2e/audit37-real-a17-forgot-passcode.spec.ts` (run with `playwright.audit37-real.config.ts`; needs the PROJEXA project's
`SUPABASE_SERVICE_ROLE_KEY` in the test process environment and a person/agent who can read the recipient's mailbox, so it is NOT in any
CI config). No link, code, passcode or key appears in these files.

Real local production build (`next build --webpack` + `scripts/make-release.mjs`, `next start` on :3107), real PROJEXA Supabase project
(evpckeuxgvahguwsaeul) and its own built-in mailer, real Chromium. Nothing stubbed. One throwaway confirmed account per run, address a Gmail
plus-address of the owner, deleted in afterAll.

| File | Credential | Result |
|---|---|---|
| `a17-forgot-passcode-1-real-email.txt` | the REAL e-mail (exactly one sent) | tests 1-3 pass; test 4's persisted checks pass (new passcode -> 200 and into the app, old passcode -> 400 and stays on /login) but the test then failed on the spec's own locator (it read Next's empty route announcer instead of the form's error line); test 5 did not run. Locator fixed. |
| `a17-forgot-passcode-2-rerun-no-email.txt` | `A17_CREDENTIAL=admin`: the same kind of one-time credential (token_hash + 6-digit code) minted by the admin API, NO e-mail | 4/4 pass (the e-mail test is skipped) |

What run 1 proves with the real e-mail:
1. `/forgot-password` on laptop 1 -> `POST /auth/v1/recover` 200; `recovery_sent_at` stamped on the account. Supabase auth log:
   `mail.send`, `mail_type=recovery`, from `noreply@mail.app.supabase.io` to the plus-address, 17:48:44Z.
2. The e-mail arrived in the owner's Gmail inbox (subject "Reset your password", sender "Supabase Auth") within the same minute (Gmail time 23:18 IST = 17:48 UTC). It carries a
   "Reset PIN" link `https://projexa-ai.com/auth/callback?token_hash=...&type=recovery&redirectTo=/reset-password` (built on the project's
   site URL by the custom recovery template) and exactly one 6-digit code. The spec opened the same path + query on the local build.
3. NEW laptop (empty browser profile): opening the link made no `/verify` call and set no session; it showed "Confirm it is you" asking for
   the address and the 6 digits. SEEN TO FAIL: a wrong 6-digit code was refused ("invalid/expired"), the page stayed on `/auth/callback`,
   no session, and the OLD passcode still signed in for real on another empty profile (passcode NOT changed).
4. The right code -> `/reset-password` -> new 6-digit passcode -> `PUT /auth/v1/user` 200 -> into the app. Re-read by real sign-ins on
   fresh profiles: the NEW passcode -> 200 and leaves /login; the OLD passcode -> Supabase 400 and the page stays on /login (A18: the
   account is intact after the reset).

What run 2 adds (no e-mail): the whole new-laptop flow again with the fixed locator, plus SEEN TO FAIL for the USED link: on another new
laptop the same link + the same code is refused (stays on the code form, no session); on laptop 1 (the machine that asked, which uses the
link directly) the used link shows "Sign-in link could not be used"; the new passcode still signs in afterwards.

Not proven here: laptop 1 using the real e-mail's link directly (its token_hash carries the `pkce_` prefix; the admin-minted one in run 2
does not). The used-link refusal was proven with the admin-minted credential only, because the brief allowed exactly one real e-mail.
A24 (delivery at user volume) is NOT claimed: the project still uses the built-in mailer (2 e-mails an hour, project-team addresses only).

Cleanup (both runs, afterAll + independent SQL re-read): auth.users / identities / sessions / profiles / memberships / security_audit_log
rows of the two throwaway accounts = 0. The one test e-mail was moved to Gmail Trash.
