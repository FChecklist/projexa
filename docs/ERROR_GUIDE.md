# Guided error recovery

When something fails, the screen never just says "error". It says what happened (in full), why, the numbered steps to take, takes the person to the
exact place it can be corrected, and brings them back with what they typed still in place. No popups: an inline panel (`role="alert"`) at the top of
the form, field messages beside bad inputs, and a "Back to what you were doing" strip.

## Add a guide (5 lines)

1. Open (or create) `src/lib/error-guide/catalogue/<name>.ts` exporting `Guide[]`; if new, spread it into `catalogue/index.ts`.
2. Add `{ id, source, match: { status?, code?, messageRegex?, apiPath?, method?, field? }, title, what, why, steps, fix?, severity }`.
3. `title` is 8 words or fewer; `what` may use `{serverMessage}`; `steps` are 1-4 imperative sentences.
4. `fix: { label, to: "/exact/url" | (ctx) => url, where: "Scope of Work > this BOQ > Approve", focus: "data-testid or id" }` sends the person to the exact
   place; `focus` is scrolled to and outlined for 3 s on arrival.
5. Run `bun test --isolate src/lib/error-guide`. The most specific guide (most `match` keys) wins; nothing matching falls back to a generic guide per
   source that shows the server's words and is logged as `guide:unmatched`.

## Parts

| Part | File |
| --- | --- |
| Contract (`Guide`, `GuideContext`) | `src/lib/error-guide/types.ts` |
| Matcher (`matchGuide`, `resolveGuide`, fallback) | `src/lib/error-guide/match.ts` |
| Catalogue | `src/lib/error-guide/catalogue/*.ts` |
| Context from a caught error / `useSubmit` failure | `src/lib/error-guide/context.ts` |
| Panel (`GuidedError`, `GuidedSubmitFailure`) | `src/components/GuidedError.tsx` |
| Way back (trail in sessionStorage: max 5, 2 h) | `src/lib/error-guide/return-trail.ts`, `src/components/ReturnStrip.tsx` (mounted in `(app)/layout.tsx`) |
| `?focus=` highlight + screen-reader announcement | `src/lib/error-guide/focus.ts` |
| Drafts (what was typed survives leaving and returning) | `src/lib/error-guide/use-draft.ts` (`useDraft(key, initial)`) |

## How it is wired

- `fetchJson` attaches `status`, `code`, `apiPath`, `method` to every error it throws (a network failure keeps its `TypeError` and gains `code: "OFFLINE"`).
  `useSubmit` puts the same facts on its `SubmitFailure`. `CreateScreen`, and the screens that used `submit.failure.message`, render the panel.
- "Fix it now" pushes `{ returnUrl, label, draftKey }` on the trail and opens the destination with `?returnTo=<id>`. A successful write on the destination
  (`fetchJson` / `useSubmit`) makes the strip say "You can go back now". "Stay here" always dismisses it.
- A signed-out save links to `/login?redirectTo=<whole current address>`; the middleware now keeps the query string in `redirectTo`.
- To keep a form's values across leaving: `const draft = useDraft("my-form", { a: "", b: "" })`, read `draft.value`, write `draft.set({ a })`, call
  `draft.clear()` after a successful save. Reference: `ProjectCreateClient`.
- Error boundaries: `(app)/error.tsx` shows the panel (guide `screen-crashed`); `global-error.tsx` has no router, so it is the same four parts in plain markup.

## Group G4: sign-in, sessions, the laptop shell, browser problems, 404/403, AI unavailable

Guides: `src/lib/error-guide/catalogue/g4-session-laptop.ts` (codes only G4 screens raise: `LOGIN_*`, `SESSION_*`, `INVITE_*`, `ORG_SETUP_*`, `OUTBOX_*`, `LAPTOP_*`, `BROWSER_*`, `AI_PILL_UNAVAILABLE`, `PAGE_*`). Panel for places without the app router (the on-laptop shell, the sign-in page): `src/components/GuidedPanel.tsx` (same four parts as `GuidedError`, plain links, extra `actions`).

| Fault | Where it is handled | Test |
| --- | --- | --- |
| empty / mistyped / misspelled e-mail, empty or short code | `app/login/page.tsx`, `lib/auth/email-code-login.ts` (`suspectedEmailTypo`) | `e2e/guided-g4-sign-in.spec.ts`, `email-code-login.test.ts`, `browser-check.test.ts` |
| wrong / expired / used code, tries left | login page | guided-g4-sign-in |
| code not arriving (cooldown, spam, change e-mail), resend wait | login page | guided-g4-sign-in |
| too many wrong tries (15 min, survives reload), Auth 429, send failure, offline first sign-in | login page | guided-g4-sign-in |
| sign-in ended while a form is open; signed out in another tab | `SessionGuard`, `lib/error-guide/form-snapshot.ts`, `M24Shell` (keeps `?redirectTo=` path + query) | guided-g4-session, `form-snapshot.test.ts` |
| deep link with a query while signed out | middleware + login page | guided-g4-session |
| no organisation yet / set-up failed | `OrgEnsure` | guided-g4-session |
| invitation not valid / closed / other e-mail / offline | `app/invite/[token]/page.tsx`, `lib/org/invite-failure.ts` | guided-g4-session, `browser-check.test.ts` |
| offline write waiting, change refused ("Line budget was not saved"), conflict, deleted, needs-you, update required, signed out, not linked | `OutboxAttention`, `ScopeBudgetScreen` (`?draft=&line=`) | `e2e/guided-g4-laptop.spec.ts`, `OutboxAttention.test.tsx` |
| project not yet copied, record not in the copy, role too low, amounts hidden | `components/local-first/ShellStateNote.tsx` (all three `StateMessage` helpers) | guided-g4-laptop |
| cookies blocked, site data blocked, store full, no IndexedDB, browser too old | `lib/browser-check.ts`, `BrowserNotice` (sign-in page) | `browser-check.test.ts` |
| AI unavailable (Copilot buttons, Discuss) with the matching ordinary screen | `CopilotClient`, `VeriComposer`, `lib/copilot-alternatives.ts` | guided-g4-session |
| 404, no access, System log for a non-owner | `app/not-found.tsx`, `NotFoundGuide`, `AccessDenied` | guided-g4-session |

A refused queued change carries `openAt` (the screen that corrects it) and `subject` (the exact record in words) from the writer that queued it (`EnqueueInput`); a writer that sets them gets the exact "Go to it and re-enter your values" button. Only the Line budget writer sets them so far.
