import { test, expect } from "@playwright/test";
import { fieldByLabel } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// KNOWN, DISCLOSED LIMITATION (commit 4fed451, "Add honest disclosure for
// Knowledge Base/Wiki create-edit limitation" -- still present in the code):
// both pages show a banner attributing New Page/Save failures to "requires
// a per-user VERIDIAN session... PROJEXA's connection to VERIDIAN currently
// authenticates with a shared organization API key."
//
// REAL ROOT CAUSE, found while writing this test (verified via direct POST
// calls + reading the actual route source, not assumed from the banner):
// the disclosed reason is not what's actually failing. All 4 real write
// routes -- src/app/api/knowledge-base/route.ts POST, .../[id]/route.ts
// PATCH, src/app/api/wiki/route.ts POST, .../[id]/route.ts PATCH -- call
// callVeridian() WITHOUT passing `organizationId: ctx.organizationId!`,
// unlike every one of their own GET handlers (which do pass it, one line
// above). Per veridian-client.ts's resolveApiKey(), omitting organizationId
// means this org's real per-org VERIDIAN API key never gets resolved --
// live testing confirms the actual failure is a 401 "Unauthorized" (the
// exact real Sonner toast text), not the disclosed per-user-session 400.
// This is a genuine, fixable, one-line-per-route PROJEXA bug (add the
// missing organizationId argument), not the deeper architectural limitation
// the banner describes -- worth Phase 4/5 fixing directly rather than
// waiting on the "per-user identity bridge" the banner implies is required.

test.describe("Wiki (/wiki)", () => {
  // GAP #3, WORSE than the disclosed limitation above: the entire Wiki
  // module fails to even RENDER, not just writes. Root-caused via source:
  // src/app/(app)/wiki/page.tsx:8 calls
  // `resolveSelectedProject(projectId)` with NO organizationId argument,
  // while every other project-scoped page in this batch's scope (e.g.
  // src/app/(app)/kpis/page.tsx:6-8) correctly calls
  // `getServerOrganizationId()` first and passes it through. Confirmed
  // live, 100% reproducible across 3 fresh browser contexts with zero
  // prior navigation: GET /wiki always renders
  // "Could not load projects: Unauthorized" and NEVER mounts WikiClient
  // at all -- so the disclosed banner text ("Viewing existing pages is
  // unaffected") is itself inaccurate for this org: viewing is also
  // broken, not just creating/editing. This is a real, one-line-fixable
  // PROJEXA bug (add the missing organizationId argument, matching
  // kpis/page.tsx's own pattern), not a fundamental limitation.
  test("real, reproducible bug: Wiki page never renders WikiClient at all -- fails with \"Could not load projects: Unauthorized\"", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByRole("heading", { name: "Wiki" })).toBeVisible();
    await expect(page.getByText("Could not load projects: Unauthorized")).toBeVisible({ timeout: 15_000 });
    // Confirms WikiClient (and therefore the disclosed per-user-session
    // banner, "No pages yet.", New Page button -- everything) never mounts.
    await expect(page.getByRole("button", { name: /new page/i })).toHaveCount(0);
  });
});

test.describe("Knowledge Base (/knowledge-base)", () => {
  test("real empty state and the disclosure banner is present (org-wide, no project needed)", async ({ page }) => {
    await page.goto("/knowledge-base");
    await expect(page.getByRole("heading", { name: "Knowledge Base" })).toBeVisible();
    await expect(page.getByText(/per-user VERIDIAN session/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("No pages yet.")).toBeVisible();
  });

  test("search control is real and returns the real empty result for a nonsense query", async ({ page }) => {
    await page.goto("/knowledge-base");
    await page.getByPlaceholder("Search…").fill("zzz-nonexistent-kb-query-zzz");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("No pages yet.")).toBeVisible({ timeout: 10_000 });
  });

  test("New Page write fails with a real 401 Unauthorized -- same missing organizationId bug as Wiki", async ({ page }) => {
    await page.goto("/knowledge-base");
    await page.getByRole("button", { name: /new page/i }).click();
    const dialog = page.getByRole("dialog");
    await fieldByLabel(dialog, "Title").fill(`E2E Batch C KB Page ${Date.now()}`);
    await dialog.getByRole("button", { name: /create/i }).click();
    await expect(page.getByText("Unauthorized")).toBeVisible({ timeout: 15_000 });
  });
});
