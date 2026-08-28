/// <reference types="bun-types" />
// R62 B7 regression test for F_010 ("PermitsListClient.tsx:76 (ScreenFrame
// newAction) -- the only in-app entry point to /permits/new is a dead
// no-op").
//
// THIS IS THE FILE THE FAULT ROW ACTUALLY NAMES, and the row's own closing
// note says plainly: no code defect was ever found here. A live re-audit
// (claude_log id 119) dispatched 5 real, coordinate-verified clicks on this
// exact "+ New" button through an authenticated session: 1/5 landed cleanly
// (URL changed, the destination's RSC fetch fired, the form rendered); the
// other 4 showed elementFromPoint confirming the click landed on the right
// element, zero console errors, and a synthetic .click() succeeding
// immediately after -- which this project's own standing memory
// (veridian_ui_click_verification_gotcha) records as the signature of a
// MISSED CLICK (a tooling/pane-compositing artifact), not a broken handler.
// PR #162, which the row was originally (and wrongly) credited to, in fact
// touched PermitCreateClient.tsx (see PermitCreateClient.test.tsx) -- an
// unrelated adjacent bug on the destination page, not this one.
//
// So there is no fix to regression-test here. What this proves instead,
// directly and reproducibly (not by a live click trace this harness cannot
// perform), is the actual mechanism the auditor's own source reading already
// confirmed: newAction={{ onClick: () => router.push(...) }} really does
// call router.push with the project-scoped URL. If that wiring were ever
// actually removed or broken -- the literal defect this fault claimed --
// this test fails.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own comment on
// this. Register only if no DOM is installed yet.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

const PermitsListClient = (await import("./PermitsListClient")).default;

afterEach(() => {
  cleanup();
  pushed.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("PermitsListClient (F_010: the '+ New' entry point genuinely navigates)", () => {
  test("clicking '+ New' calls router.push to /permits/new with the current projectId -- not a dead no-op", async () => {
    globalThis.fetch = (async () => jsonRes({ permits: [] })) as typeof fetch;

    const { getByRole } = render(<PermitsListClient projectId="proj-77" />);

    await waitFor(() => expect(getByRole("button", { name: /\+ New/i })).toBeDefined());
    fireEvent.click(getByRole("button", { name: /\+ New/i }));

    expect(pushed).toEqual(["/permits/new?projectId=proj-77"]);
  });
});
