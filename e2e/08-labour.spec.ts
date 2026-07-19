import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /labour ("Manpower & Attendance", LabourClient.tsx) is project-scoped
// (defaults to the org's first project, Meridian Heights, when navigated
// without ?projectId -- see resolveSelectedProject()). Two tabs (Roster /
// Attendance), no search/sort/pagination.
test.describe("labour", () => {
  test("baseline matches the real (empty) seed data for the default project", async ({ page }) => {
    const [rosterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/labour-roster") && r.request().method() === "GET"),
      page.goto(`/labour?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const roster = (await rosterRes.json()) as { roster: unknown[] };
    await expect(page.getByRole("heading", { level: 1, name: "Manpower & Attendance" })).toBeVisible();

    if (roster.roster.length === 0) {
      await expect(page.getByText("No workers on the roster yet.")).toBeVisible();
      // "Mark Attendance" must be disabled with an empty roster (there's
      // nobody to mark attendance for).
      await page.getByRole("tab", { name: "Attendance" }).click();
      await expect(page.getByRole("button", { name: "Mark Attendance" })).toBeDisabled();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(roster.roster.length);
    }

    test.info().annotations.push({
      type: "seed-data-note",
      description: `roster=${roster.roster.length} for ${DEFAULT_PROJECT.name} at test time. At authoring time this and every other project had 0 labour roster / attendance rows seeded -- a real seed-completeness gap for this in-scope module. A non-zero count here on a later run reflects this suite's own additive writes (no teardown -- see PHASE2_BATCH_B_FINDINGS.md's "repeated-run data accumulation" note), not new seed data.`,
    });
  });

  test("adding a worker and marking attendance both persist (real write chain)", async ({ page }) => {
    const [rosterBeforeRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/labour-roster") && r.request().method() === "GET"),
      page.goto(`/labour?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const rosterBefore = (await rosterBeforeRes.json()) as { roster: unknown[] };
    const workerName = `E2E Test Worker ${uniqueSuffix()}`;

    await expect(page.getByRole("heading", { level: 1, name: "Manpower & Attendance" })).toBeVisible();

    await page.getByRole("button", { name: "Add Worker" }).click();
    await expect(page.getByRole("dialog", { name: "Add Worker to Roster" })).toBeVisible();
    await fieldInput(page, "Name").fill(workerName);
    await fieldInput(page, "Trade (optional)").fill("Mason");
    await fieldInput(page, "Daily Rate").fill("850");
    const [rosterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/labour-roster") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Add Worker" }).click(),
    ]);
    expect(rosterRes.status()).toBe(201);
    await expect(page.getByText("Worker added to roster")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(workerName) })).toBeVisible();

    await page.getByRole("tab", { name: "Attendance" }).click();
    await expect(page.getByRole("button", { name: "Mark Attendance" })).toBeEnabled();
    await page.getByRole("button", { name: "Mark Attendance" }).click();
    await fieldInput(page, "Worker").click();
    await page.getByRole("option", { name: workerName }).click();
    await fieldInput(page, "Status").click();
    await page.getByRole("option", { name: "Half Day" }).click();
    await fieldInput(page, "Hours Worked (optional)").fill("4");
    const [attRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/attendance") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Record" }).click(),
    ]);
    expect(attRes.status(), await attRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("Attendance recorded")).toBeVisible();

    const attRow = page.getByRole("row", { name: new RegExp(workerName) });
    await expect(attRow).toBeVisible();
    await expect(attRow.getByText("half day")).toBeVisible();

    const [rosterAfterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/labour-roster") && r.request().method() === "GET"),
      page.reload(),
    ]);
    const rosterAfter = (await rosterAfterRes.json()) as { roster: { name: string; trade: string | null }[] };
    expect(rosterAfter.roster.length).toBe(rosterBefore.roster.length + 1);
    const createdWorker = rosterAfter.roster.find((r) => r.name === workerName);
    expect(createdWorker?.trade).toBe("Mason");
  });
});
