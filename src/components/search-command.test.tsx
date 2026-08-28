/// <reference types="bun-types" />
// R62 B7 regression test for R48_GLOBAL_SEARCH_OPENS_NOTHING_01 (High).
//
// UAT's own careful diagnosis: the header "Search" control's click
// DEMONSTRABLY LANDS (activeElement became the Search button, the clicked
// point matched the control's own computed centre) and still opened
// nothing -- zero [role=dialog] elements, zero visible inputs, no palette,
// every time.
//
// ROOT CAUSE (confirmed here by reading both the pre-fix and post-fix
// source, not by trusting the fault row's text): pre-fix, search-command.tsx
// held `let openDialog: (() => void) | null = null` at MODULE scope --
// shared by every mounted SearchDialog instance. Each instance wrote its own
// setOpen into that one slot on mount and wrote `null` back on unmount,
// UNCONDITIONALLY, with no check that it still owned the slot. SearchTrigger
// mounts more than one SearchDialog by construction (a Suspense fallback
// instance plus the real resolved child, since useSearchParams() suspends
// during prerender): whichever instance's cleanup runs LAST nulls the slot
// out from under whichever instance the user still sees on screen, and from
// that point the button's onClick (`openDialog?.()`) is a permanent,
// silent no-op.
//
// THIS TEST reproduces that exact class of bug deterministically -- two
// SearchDialog-registering instances mounted concurrently, then one
// unmounted -- without depending on React/Next's internal Suspense-timing
// specifics (verified separately that those are not reliably reproducible
// under bun:test/happy-dom; this construction is not). It mounts two
// independent <SearchTrigger/> instances (standing in for the fallback +
// child that a single trigger really mounts), unmounts the second, and then
// clicks the first's still-visible button. Confirmed by direct A/B run
// against the pre-fix source (module-level `openDialog` singleton restored
// from commit dd85a07~1): this test fails there (click is a no-op, no
// search input ever appears) and passes against the current source, where
// `open` lives in SearchTrigger and is passed down as a prop -- there is no
// shared slot left for one instance's unmount to clobber.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// See src/components/ui/form-field.test.tsx for why this guard exists:
// `bun test` runs every file in one process, and re-registering happy-dom
// throws.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
// NOTE: deliberately not importing `screen` from @testing-library/react --
// it binds to the global `document` at module-evaluation time, which
// happens before the GlobalRegistrator.register() call above runs (import
// statements are hoisted ahead of ordinary statements), leaving `screen`
// bound to an undefined document. Every other suite in this repo works
// around the same hazard by querying off `render()`'s own return value.

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => ({ get: () => null }),
}));
// SearchDialog's debounce effect calls fetch() once a query is typed; this
// test never types anything, but stub it defensively so the suite never
// depends on real network access.
(global as unknown as { fetch: typeof fetch }).fetch = (async () =>
  ({ ok: true, json: async () => ({ results: null }) }) as Response) as typeof fetch;

const { SearchTrigger } = await import("./search-command");

afterEach(() => {
  cleanup();
});

// Stands in for the fallback-instance + real-instance pair that a single
// SearchTrigger's Suspense boundary mounts in production: two independent
// consumers of search-command.tsx's dialog-opening machinery, one of which
// gets unmounted while the other stays on screen.
function TwoInstanceHarness() {
  const [showSecond, setShowSecond] = useState(true);
  return (
    <div>
      <div data-testid="first"><SearchTrigger /></div>
      {showSecond && <div data-testid="second"><SearchTrigger /></div>}
      <button data-testid="unmount-second" onClick={() => setShowSecond(false)}>
        unmount second
      </button>
    </div>
  );
}

test("R48_GLOBAL_SEARCH_OPENS_NOTHING_01: Search button still opens the palette after a second dialog-owning instance unmounts", async () => {
  const { getByTestId, getAllByRole, findByPlaceholderText } = render(<TwoInstanceHarness />);

  // Unmount the second instance -- pre-fix, its cleanup effect nulls the
  // shared module-level slot regardless of which instance the user is still
  // looking at, exactly like the Suspense fallback unmounting in production.
  await act(async () => {
    fireEvent.click(getByTestId("unmount-second"));
  });

  const remainingButtons = getAllByRole("button", { name: /search/i });
  expect(remainingButtons).toHaveLength(1);

  fireEvent.click(remainingButtons[0]);

  // Pre-fix: the click lands (the button is real and mounted) but the
  // shared opener slot was already nulled, so nothing below ever appears.
  // Post-fix: each SearchTrigger owns its own `open` state, so the click
  // always opens that instance's palette.
  const input = await findByPlaceholderText("Search…");
  expect(input).toBeTruthy();
});
