/// <reference types="bun-types" />
// R62 B7 regression test for A4S14_copilot_01 (High), fixed in PR #165 (ebbd0dd).
//
// RECORDED: a "Run" quick-action card 504'd with no error toast/inline
// message confirmed. HALF THE RECORDED DIAGNOSIS DID NOT HOLD ON READING THE
// CODE: runTool() already read res.ok and toasted the backend's own message
// -- that half was never broken. What WAS broken is the OTHER fetch:
// loadHistory() had no res.ok check, so a failed GET /api/assistant made
// `data.queries` undefined, `?? []` made it an empty array, and "Recent
// Construction Queries" rendered as "no queries yet" instead of "this
// failed".
//
// THE FIX: fetchJson reads the status first; on failure a distinct error
// state (role="alert", the backend's own message, Retry) replaces the
// "No construction Copilot queries yet" empty copy.
//
// This test fails without the fix: reverting loadHistory() to a bare
// `res.json()` makes the empty-state copy render on a real 500 instead of
// the error card.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

// CopilotClient's only use of useVeriChat() is setComposerMode/bumpRefresh,
// both fire-and-forget UI hooks unrelated to this fault. The real hook pulls
// in the shared veridian-ui-kit context factory (its own capability-tree
// fetch, provider tree, etc.) which is unrelated infrastructure this fault
// does not touch -- stub only useVeriChat so the test stays scoped to the
// actual defect.
//
// mock.module() replaces the module for the rest of THIS bun test PROCESS
// (bun runs every file in one process -- see PayrollClient.test.tsx's own
// comment on this), so every other export this module carries -- including
// the pure functions veri-chat-context.test.ts imports and asserts on
// directly (mergeChainTrees, fetchCapabilityTree, fetchJsonNodes,
// SHOW_UNDISPATCHABLE_MODULE_CHAINS) -- is spread through UNCHANGED rather
// than dropped, so that suite still sees the real implementations.
const RealVeriChatContext = await import("@/components/veri-chat/veri-chat-context");
mock.module("@/components/veri-chat/veri-chat-context", () => ({
  ...RealVeriChatContext,
  useVeriChat: () => ({ setComposerMode: () => {}, bumpRefresh: () => {} }),
}));

const CopilotClient = (await import("./CopilotClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

describe("CopilotClient (A4S14_copilot_01)", () => {
  test("a failing GET /api/assistant shows the backend's own error with Retry, never the confident 'run one above' empty state", async () => {
    globalThis.fetch = router({
      "/api/assistant": () => jsonRes({ error: "VERIDIAN request timed out after 20000ms" }, 504),
    });

    const { getByRole, queryByText } = render(<CopilotClient projectId="proj-1" />);

    const alert = await waitFor(() => getByRole("alert"));
    expect(alert.textContent).toContain("VERIDIAN request timed out after 20000ms");
    expect(getByRole("button", { name: "Retry" })).toBeDefined();
    expect(queryByText(/No construction Copilot queries yet/)).toBeNull();
  });
});
