import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

// lf-e11, found by the real-browser run of two people on one laptop: the "skipped in this tab" marker was ONE sessionStorage key for the
// whole tab, so after the first person had seen (or skipped) "Preparing your workspace", the NEXT person to sign in on the same tab was
// never prepared at all -- their projects were not copied to the laptop before they started (and their AI had nothing to read offline).

const who = { id: "omar" };
mock.module("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));
mock.module("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: who.id } } }) } }) }));
const realPrepare = await import("@/lib/local-first/prepare-workspace");
mock.module("@/lib/local-first/prepare-workspace", () => ({
  ...realPrepare,
  // The screen's own progress, without running the real steps (release install, replica): this test is about WHETHER it opens.
  prepareWorkspace: async (o: { onProgress: (p: unknown) => void }) => {
    o.onProgress({ percent: 0, remainingMs: 1000, finished: false, timedOut: false, steps: [] });
    return { ready: false };
  },
}));
const { LOCAL_FIRST_FLAG } = await import("@/lib/local-first/local-reader");
const { WorkspacePrepare, seenKey } = await import("./WorkspacePrepare");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(LOCAL_FIRST_FLAG, "1");
});
afterEach(() => cleanup());

test("the first person skipped it in this tab; the NEXT person to sign in on the same tab still gets their workspace prepared", async () => {
  sessionStorage.setItem(seenKey("asha"), "1");
  who.id = "omar";
  const { findByRole } = render(<WorkspacePrepare />);
  expect(await findByRole("dialog", { name: "Preparing your PROJEXA workspace" })).toBeTruthy();
});

test("the same person who skipped it in this tab is not shown it again", async () => {
  sessionStorage.setItem(seenKey("omar"), "1");
  who.id = "omar";
  const { queryByRole } = render(<WorkspacePrepare />);
  await new Promise((r) => setTimeout(r, 50));
  await waitFor(() => expect(queryByRole("dialog", { name: "Preparing your PROJEXA workspace" })).toBeNull());
});
