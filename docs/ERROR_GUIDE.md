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

## Form helpers (added by group G3: materials, labour, documents, drawings, permits, MoMs, schedule, design studio, reports, settings)

All in `src/lib/guided-form.ts`; none runs at page load (they touch `sessionStorage` only after the form is on screen).

| Need | Use |
| --- | --- |
| Keep every typed value of a form across a "Fix it now" detour, a reload and a sign-in that ran out | `const draft = useFormDraft("material-new:" + projectId)`; read `draft.values`, write `draft.onChange(name, value)`, `draft.clear()` after a successful save; show `<DraftRestoredNote draft={draft} />` |
| A mistake the form finds itself, before anything is sent | `fault(CODE, fieldId, "plain sentence naming the value")` inside `useCheckedSubmit(submit, () => fault(...) \| null)`; pass `checked.failure / onRetry / onSubmit` to `CreateScreen` |
| A refused edit, status change, delete or void on an object page | `const { problem, show, clear } = useProblem({ entityId, entityType })`; in the `catch`, `show(err)`; render `<ProblemPanel problem={problem} />` |
| Turn a refused `fetch` into an error the matcher understands | `throw httpError(res, body, "fallback", "PATCH", "/api/x/1")` |
| A server sentence the harvested catalogue does not hold | add it to `SERVER_MESSAGE_CODES`; `contextFromError(err, withServerCode(err, {...}))` then picks the code-keyed guide |

Rules that keep the "exact place" promise: the `fieldId` of a fault must be an `id`, `name` or `data-testid` that exists on the screen (it becomes `?focus=` and is outlined for 3 s), and a guide whose source is `validation` and names no `focus` of its own gets that field automatically. A file a browser cannot restore (an upload) is the one thing a draft cannot keep: the screen says "choose the file again".
