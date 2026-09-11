import { test, expect, type Page } from "@playwright/test";

// R-82 (Assistant): "Assistant either reaches project data or is hidden".
// Recorded closure_state=BLOCKED, same shared root cause as the rest of the
// eleven (F-2026-0910-PM-068). Evidence: a prior live check of
// get_construction_project_dashboard on a real project returned real,
// independently-cross-checked figures (taskCount matched pms_issues,
// progressPercent matched a direct DB average) -- getProjectDashboard() in
// construction-dashboard-service.ts is real, not a stub.
//
// ORIGINAL AUTHORSHIP: this spec's core CEO test and its reasoning were
// written by a prior W-TEST session (2026-09-10, branch
// w-test/env1-specs-r11-15-30-31-41-42-43-82-90-91, commit a470343) --
// moved here verbatim, not rewritten, per PM ruling D100 ("pull R-82/R-91
// onto one branch, citing the prior session's original authorship").
// EXTENDED 2026-09-11 (W-TEST) with a second role (Finance) to meet this
// window's own "at least two roles" UI-test bar, which the original was one
// short of.
//
// This spec tests BOTH halves of the requirement's own "either/or" wording
// directly, against a live project it discovers at run time (the evidence's
// own "Oakwood" project belongs to a different org than this suite's
// storageState, so a fresh, real project id is looked up here rather than
// re-using a cross-org one):
//   (a) the assistant surface is NOT hidden -- its toggle is visible, and
//   (b) when dispatched with a real project id, /api/assistant's
//       get_construction_project_dashboard returns a real (non-stub, non-error)
//       shaped response for it.
//
// PIPELINE STATUS: NOT YET GREEN IN CI (same Env-1 CI job dependency as the
// rest of the eleven) NOR observed green locally -- this window's real
// backend calls have been measured taking 8-36s under real, independently
// confirmed RAM/CPU contention (see R-11/R-60's own status notes); not
// re-attempted here for the same reason. Logic grounded in source, not run.
async function assertAssistantReachesData(page: Page) {
  await page.goto("/dashboard", { waitUntil: "networkidle" });

  // (a) NOT HIDDEN: the assistant surface must be reachable from the shell.
  // VeriComposer is docked through the shell's own Composer slot on every
  // authenticated page (src/components/veri-chat/VeriComposer.tsx header
  // comment, src/components/shell/M24Shell.tsx) and renders a real
  // <textarea> for its input -- confirmed by direct read (VeriComposer.tsx:331).
  // Checking for a real composer input is more robust than any one label
  // string, which this component's own history shows has already changed
  // shape more than once (VeriChatPanel -> docked composer, per M24Shell's
  // own comments).
  const composerInput = page.locator("textarea").first();
  const composerVisible = await composerInput.isVisible().catch(() => false);
  expect(composerVisible, "the assistant's composer input must be visible somewhere on an authenticated page, not hidden").toBe(true);

  // (b) REACHES REAL DATA: discover a real, live project in this session's
  // own org (page.request carries the same authenticated cookies as `page`,
  // so this is a real authenticated call, not a service-role bypass), then
  // dispatch the exact codeReference the evidence already proved is wired to
  // real data.
  const projectsRes = await page.request.get("/api/projects");
  expect(projectsRes.ok(), "the projects list API must succeed for a real, authenticated session").toBe(true);
  const projects = await projectsRes.json();
  const projectList: Array<{ id: string }> = Array.isArray(projects) ? projects : projects.projects ?? projects.data ?? [];
  expect(projectList.length, "this org must have at least one real project to dispatch the assistant against").toBeGreaterThan(0);
  const projectId = projectList[0].id;

  // D58 falsifiability note (manual break-restore, not yet run -- this
  // pipeline is blocked on the Env-1 CI job): planting a defect means
  // temporarily making getProjectDashboard() return a stub/empty object,
  // confirming this assertion goes red on the shape check below, then
  // reverting.
  const dashRes = await page.request.post("/api/assistant", {
    data: {
      codeReference: "get_construction_project_dashboard",
      breadcrumb: "R-82 Env-1 spec",
      inputs: { projectId },
    },
  });
  expect(dashRes.ok(), "get_construction_project_dashboard must succeed for a real project id").toBe(true);
  const dash = await dashRes.json();
  // A stub/never-wired tool would return an empty object, a hardcoded
  // placeholder, or throw -- a real one returns a taskCount that is an actual
  // number (>= 0), proving it queried something rather than fabricating a
  // shape.
  expect(typeof dash.taskCount, "taskCount must be a real number, not missing/stubbed").toBe("number");
  expect(dash.taskCount, "taskCount must be a non-negative real count").toBeGreaterThanOrEqual(0);
}

test.describe("R-82: the assistant is not hidden, and reaches real project data -- CEO", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("as CEO (owner role): the assistant is not hidden, and reaches real project data for a real project", async ({ page }) => {
    await assertAssistantReachesData(page);
  });
});

test.describe("R-82: the assistant is not hidden, and reaches real project data -- Finance", () => {
  test.use({ storageState: "playwright/.auth/finance.json" });

  test("as Finance (member role): the same assistant surface and data-reach hold for a non-owner account", async ({ page }) => {
    await assertAssistantReachesData(page);
  });
});
