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
