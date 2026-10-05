# B1 owner step: sign in on the live site with your real 6-digit passcode

AUDIT-100 row B1. Everything else about this row is proven by `e2e/live-site-smoke.spec.ts` against https://projexa-ai.com, including
mutations that were seen to fail: the passcode field takes exactly 6 digits, and a wrong passcode is refused while you stay on /login.
The one thing a test cannot do is sign in with a REAL passcode, because only you have one. No passcode or e-mail goes in this file.

1. Open https://projexa-ai.com/login in a private window. Type your PROJEXA e-mail and your 6-digit passcode. Press Sign in.
2. Check: you land on your dashboard (the address no longer ends in /login) and your name or organisation shows at the top.
3. Write the result in AUDIT_100_CHECKLIST row B1: the date, "signed in: yes" or "no", and, if no, the exact message on the screen.
