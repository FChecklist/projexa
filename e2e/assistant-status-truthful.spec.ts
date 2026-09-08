import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// R48 / fault R48_TICK_ON_ERROR_01.
//
// The Assistant Overview timeline used to choose its badge glyph from
// item.type, never from item.status, so a FAILED or still-RUNNING query
// rendered exactly the same success tick as a completed one. Observed live
// on https://projexa-ai.com/settings at 8a5eb59: six rows showed a tick
// while their own status sub-label read "Error".
//
// STALE, confirmed by reading source (not by running anything): the screen
// this test targeted no longer exists anywhere reachable. data-testid=
// "overview-item" / data-status / the three aria-labels below all live in
// exactly one place in src/ -- VeriChatPanel.tsx's Overview() -- and that
// component is not mounted. src/app/(app)/layout.tsx, "the ONE place that
// governs all 53 app routes" per its own header, deleted it during the M24
// rewrite: "VeriChatPanel -> no longer a separate pane" (layout.tsx:24-25).
// The real current shell, M24Shell.tsx, never references overview-item,
// data-status, or any of these aria-labels. So page.goto("/dashboard")
// against the real app renders none of this: the row-count poll this test
// used to run would time out, not because the R48 bug reproduces, but
// because the screen it looked at is gone. (VeriComposer.tsx and
// HomeThreadSlot.tsx, that panel's siblings, are equally unmounted -- zero
// JSX call sites anywhere in src/ -- so the "docked panel + bottom composer
// on every page" architecture this screen belonged to was removed in full,
// not relocated to a new route.)
//
// The one place a query's status is still rendered to a real user is
// CopilotClient.tsx's "Recent Construction Queries" list on /copilot -- it
// is still live because it calls /api/assistant directly (CopilotClient.tsx
// loadHistory()/runTool()), independent of the dead VeriComposer/
// VeriChatPanel wiring. It carries no data-status/aria-label contract, so
// the original assertion can't be ported literally -- but it does pick the
// badge's *visual* variant from q.status via a ternary chain
// (CopilotClient.tsx:155) that is written completely separately from the
// badge's *text*, which is q.status itself. That is the same shape of risk
// the original bug was: two independent expressions reading the same
// status, either of which can drift on its own without the other. This
// rewrite re-points the property at that real, current pair.
//
// This stays a PROPERTY test, not a fixture test, for the reason the
// original comment gave: it holds for whatever queries happen to exist at
// run time (this is a shared, persistent E2E org), not a fixed set.
test.use({ storageState: "playwright/.auth/ceo.json" });

// badge.tsx's cva() output for each variant CopilotClient.tsx:155 can pick
// (src/components/ui/badge.tsx:12-19): "default" => bg-primary, "secondary"
// => bg-secondary, "destructive" => bg-destructive. Every status
// assistant_queries can hold (src/app/api/assistant/route.ts only ever
// writes "pending" at insert time, then "done" or "error" on completion --
// lines 76, 90, 100) maps to exactly one of these.
const EXPECTED_VARIANT_CLASS: Record<string, string> = {
  done: "bg-primary",
  error: "bg-destructive",
  pending: "bg-secondary",
};

test("Copilot query history badge never contradicts the row's own status", async ({ page }) => {
  await page.goto(`/copilot?projectId=${DEFAULT_PROJECT.id}`);

  // Guarantee at least one row exists rather than depending on whatever
  // leftover history earlier suite runs left in this shared, persistent
  // org. POST /api/assistant's codeReference path is synchronous end to end
  // (route.ts: insert "pending" row, await callVeridian, update to "done"/
  // "error", THEN respond) -- so by the time this click's request resolves,
  // the row it created already carries its final status. "pending" is a
  // real value in the schema but exists in the DB only for the request's
  // own duration, never long enough for a GET to observe it; the
  // EXPECTED_VARIANT_CLASS entry above is kept for completeness, not
  // because this test expects to see it.
  await page.getByRole("button", { name: "Run" }).first().click();

  const badges = page.locator('[data-slot="badge"]');
  await expect
    .poll(async () => badges.count(), {
      message: "Recent Construction Queries never rendered a row to check",
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  const count = await badges.count();
  for (let i = 0; i < count; i += 1) {
    const badge = badges.nth(i);
    const status = (await badge.textContent())?.trim() ?? "";

    const expectedClass = EXPECTED_VARIANT_CLASS[status];
    expect(expectedClass, `unknown status "${status}" rendered by the badge`).toBeTruthy();

    // The badge's own colour must state the row's own outcome -- never a
    // different status's colour behind the text it is itself displaying.
    await expect(
      badge,
      `row ${i} reads "${status}" so its badge must render the "${expectedClass}" variant`,
    ).toHaveClass(new RegExp(expectedClass));
  }
});
