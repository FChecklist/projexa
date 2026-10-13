// UAT 2026-10-12: the background catch-up of the laptop copy (auto-sync) was started only inside the /local shell, so a person working on the
// normal pages kept a one-time snapshot and the offline shell showed an old picture. The normal shell must start it too, only with the laptop
// copy switched on and a known person, and stop it when it unmounts. (Source contract: the shell itself needs a browser, Supabase and a database.)
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "M24Shell.tsx"), "utf8");

describe("M24Shell starts the background refresh of the laptop copy", () => {
  test("loads the peer/auto-sync module and starts it for the signed-in person", () => {
    expect(source).toContain('import("@/lib/local-first/background-refresh")');
    expect(source).toContain("refresh.createBackgroundRefresh(");
  });

  test("only with the laptop copy on and a known person", () => {
    const at = source.indexOf('import("@/lib/local-first/background-refresh")');
    const before = source.slice(Math.max(0, at - 400), at);
    expect(before).toContain("if (!userId || !isLocalFirstEnabled()) return;");
  });

  test("stops it again when the shell unmounts", () => {
    expect(source).toContain("clearInterval(tick)");
  });

  // F63 / checklist 2.23: the offline shell no longer has a project key of its own to keep in step; it reads the rail's store.
  test("does not keep a second, offline-only project key", () => {
    expect(source).not.toContain("px-shell-project");
  });

  test("a first visit (no project cookie yet) never triggers a full reload: the install screen must be drawn once", () => {
    expect(source).toContain("if (!hadCookie) return;");
  });

  // R-81/R-82: "That is not enabled for this workspace yet - Open RFIs" must come with a working "Open RFIs" button (the route was dropped).
  test("a gap answer keeps the screen link the server sends and renders it as a button", () => {
    expect(source).toContain('verdict.status === "gap" ? verdict.links?.find');
    expect(source).toContain("onClick={() => router.push(notice.link!.route)}");
  });

  // live finding 2026-10-13: a person whose organisation changed was refused for ever; the callers rebuild the copy (org-change.ts)
  test("both background syncs (this shell's refresh and the auto-sync scheduler) rebuild a copy refused because the organisation changed", () => {
    expect(source).toContain("orgChange.syncRecoveringFromOrgChange(");
    const peer = readFileSync(join(import.meta.dir, "..", "..", "lib", "local-first", "peer", "peer-shared.ts"), "utf8");
    expect(peer).toContain("syncRecoveringFromOrgChange(() => replica.sync()");
  });
});
