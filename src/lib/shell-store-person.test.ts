import { afterEach, expect, test } from "bun:test";
import { dropShellIfNotFor, getShellSnapshot, getShellUserId, loadShell, resetShellStore } from "./shell-store";

// lf-e11, found by the real-browser run of two people on one laptop: the shell store is module-level and outlives a sign-out in the same
// tab, so the NEXT person saw the previous person's organisation and projects. dropShellIfNotFor() (called by M24Shell once it knows
// who is signed in) drops an answer held for somebody else, and keeps one that is this person's.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetShellStore();
});

async function loadFor(userId: string, orgName: string) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ organization: { id: `org-${userId}`, name: orgName }, userId, role: "member", email: `${userId}@x.test`, projects: [{ id: "p1", name: `${orgName} tower` }], pillUsage: [], fetchedAt: Date.now(), errors: {} }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  await loadShell(true);
}

test("an answer held for ANOTHER person is dropped at once", async () => {
  await loadFor("asha", "Harbor Builders");
  expect(getShellUserId()).toBe("asha");
  expect(dropShellIfNotFor("omar")).toBe(true);
  expect(getShellSnapshot().data).toBeNull();
  expect(getShellUserId()).toBeNull();
});

test("this person's own answer is kept (no refetch, no flash)", async () => {
  await loadFor("asha", "Harbor Builders");
  expect(dropShellIfNotFor("asha")).toBe(false);
  expect(getShellSnapshot().data?.organization?.name).toBe("Harbor Builders");
});

test("nothing held: nothing to drop", () => {
  expect(dropShellIfNotFor("asha")).toBe(false);
});
