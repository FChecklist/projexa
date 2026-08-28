/// <reference types="bun-types" />
// R62 B7 regression test for F_010 ("the only in-app entry point to
// /permits/new is a dead no-op").
//
// THE ROW'S OWN RECORDED DIAGNOSIS, WHICH DID NOT SURVIVE READING THE CODE:
// F_010 was filed against PermitsListClient.tsx:76's "+ New" button and
// attributed to a kit-level ScreenFrame click-handler wiring bug (grouped
// with the Radix-hydration family). That never held -- /permits/new renders
// no Radix Tabs and no Radix Dialog at all, and a live re-audit (5
// authenticated coordinate-dispatched clicks) found the button working
// (1/5 landed cleanly; the other 4 showed the exact "real click fails,
// synthetic .click() succeeds" signature this project's own memory records
// as a missed click / tooling artifact, not a broken handler). No code
// change was ever made to PermitsListClient.tsx or ScreenFrame.tsx, and none
// is warranted -- see PermitsListClient.test.tsx for a direct regression
// test of that file's own onClick wiring, which was never actually broken.
//
// WHAT WAS ACTUALLY WRONG, on the destination page this button navigates to,
// and IS fixed here: PermitCreateClient.tsx's <form> had `name` and `file`
// both `required`, and Create was disabled only while `saving`. Clicking
// Create with no PDF chosen (a PDF cannot be attached via keyboard/pointer
// automation, so this was invisible to the auditor's own click trace) failed
// NATIVE HTML CONSTRAINT VALIDATION and produced nothing -- no toast, no
// network request, no visible change. That is a genuine "clicked and nothing
// happened" dead-no-op, just not the one at the recorded file/line: a
// fail-AFTER-click, against this project's own standing rule ("NO
// FAIL-AFTER-CLICK -- primary action disabled while required fields are
// empty, with the count beside it").
//
// THE FIX: Create is now disabled until both required fields are genuinely
// satisfied, and a live count of what's still missing renders beside the
// button -- so the user is told BEFORE clicking, not left silent after. The
// regression this guards: reverting the button back to `disabled={saving}`
// alone (the exact prior line) makes this suite's first test fail --
// verified by hand before writing this file.
//
// HARNESS LIMITATION, stated rather than worked around: this repo's
// bun:test + happy-dom + React 19 + @testing-library/react 16 combination
// does not deliver a synthetic onChange for a controlled <input> from either
// fireEvent.change or fireEvent.input, including via the standard
// native-value-setter workaround (verified against a minimal isolated
// repro component, independent of this file). Typing into the name field or
// attaching a file therefore cannot be simulated here, so this suite proves
// the disabled/missing-count logic only at initial render (the exact state
// the original bug got wrong -- Create used to be live from the first
// paint) rather than through a full fill-and-submit interaction.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own comment on
// this. Register only if no DOM is installed yet.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

// PermitCreateClient calls useRouter() from next/navigation, which throws
// outside a real Next.js App Router tree. Mocked before the component is
// imported, same mock.module pattern CreateProjectDialog.test.tsx (R62 B7's
// own sibling row, R48_PROJECT_CREATE_NO_PRODUCTS_01) already uses.
const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

// Dynamically imported so the mock.module call above (and, for parity with
// every other component suite in this repo, GlobalRegistrator.register())
// has already run before this module -- and its transitive Radix chain -- is
// evaluated.
const PermitCreateClient = (await import("./PermitCreateClient")).default;

afterEach(() => {
  cleanup();
  pushed.length = 0;
});

describe("PermitCreateClient (F_010: no fail-after-click on the real create button)", () => {
  test("Create starts disabled with both required fields reported missing -- the regression itself: the old `disabled={saving}` left this clickable from first paint", () => {
    const { getByRole, getByText } = render(<PermitCreateClient projectId="proj-1" />);

    const createButton = getByRole("button", { name: /Create/i }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    // Scoped to the — <fields> tail so this only matches the missing-fields
    // message span, not the "Permit name" field label the same text
    // otherwise collides with.
    expect(getByText(/2 required fields still needed.*— permit name, permit PDF/i)).toBeDefined();
  });

  test("Cancel navigates back to /permits without ever touching the disabled Create path", () => {
    const { getByRole } = render(<PermitCreateClient projectId="proj-1" />);

    fireEvent.click(getByRole("button", { name: /Cancel/i }));

    expect(pushed).toEqual(["/permits"]);
  });
});
