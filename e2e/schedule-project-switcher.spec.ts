import { test, expect } from "@playwright/test";
import { PROJECTS } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// PROJEXA-E2E-001 section 5 item 6. Owner's own words: "/schedule -- Ignores
// the project switcher, reads only ?projectId=. Looks broken unless you know."
//
// ROOT CAUSE (confirmed by reading the code, not guessed from the symptom).
// /schedule/page.tsx is the one project-scoped screen that resolves its
// project via resolveRouteProject() (src/lib/project-selection.ts -- the
// R67 A-13 "strict" resolver), instead of resolveSelectedProject()/
// resolveProjectForModule() the way every other project-scoped page does.
// Both of those other two also honour the veri.rail.project cookie the
// top-rail project switcher (TopRail.tsx, via M24Shell.tsx's chooseProject())
// writes -- resolveRouteProject() used to look ONLY at the URL's own
// ?projectId=. Worse, chooseProject() itself only pushes a NEW ?projectId=
// into the URL when the CURRENT url already carries one; otherwise it writes
// the cookie and calls router.refresh(). That refresh is enough for the ~50
// cookie-aware pages, but was a silent no-op for /schedule, which never read
// the cookie at all -- so picking a project from the switcher while standing
// on a bare /schedule (or landing on a bare /schedule after switching
// elsewhere) visibly did nothing.
//
// This spec proves both halves named in the work order: (a) the switcher's
// remembered choice now reaches /schedule on a bare navigation -- this is
// the actual regression, and before the fix in project-preference.ts/
// project-selection.ts this test's second assertion fails, landing on the
// "Pick a project" card instead; (b) an explicit ?projectId= deep link still
// renders exactly the project it names and is never overridden by a stale
// switcher choice, so shared/deep links (this work order's later AI-link and
// email surfaces) keep working.
test.describe("/schedule respects the top-rail project switcher", () => {
  test("an explicit ?projectId= deep link always wins, even over a different remembered choice", async ({ page }) => {
    // Switch to project A first, via the URL, so a rail preference for A is
    // recorded (M24Shell writes the cookie on every project change, not only
    // from the switcher UI -- see chooseProject()'s own call to
    // writeStoredProjectId()).
    await page.goto(`/schedule?projectId=${PROJECTS.emeraldBusinessPark.id}`);
    await expect(page.getByTestId("schedule-breadcrumb")).toContainText(PROJECTS.emeraldBusinessPark.name);

    // A deep link naming a DIFFERENT project must render that project, not
    // the one just remembered.
    await page.goto(`/schedule?projectId=${PROJECTS.riversideSchool.id}`);
    await expect(page.getByTestId("schedule-breadcrumb")).toContainText(PROJECTS.riversideSchool.name);
  });

  test("switching projects from the top-rail switcher updates /schedule immediately, and survives a bare re-navigation", async ({
    page,
  }) => {
    // Start on a known project via a deep link.
    await page.goto(`/schedule?projectId=${PROJECTS.emeraldBusinessPark.id}`);
    await expect(page.getByTestId("schedule-breadcrumb")).toContainText(PROJECTS.emeraldBusinessPark.name);

    // Open the top-rail switcher (TopRail.tsx) -- a real button with an
    // aria-label naming the current project, opening a role="listbox" of
    // every project the org has.
    const switcherButton = page.getByRole("button", { name: /Click to switch project\.$|^No project selected\./ });
    await switcherButton.click();
    const listbox = page.getByRole("listbox", { name: "Switch project" });
    await expect(listbox).toBeVisible();
    await listbox.getByRole("option", { name: PROJECTS.riversideSchool.name }).click();

    // Direction 1: the URL already named a project, so chooseProject() pushes
    // the new id into it and the pane updates immediately -- this direction
    // is not the regression (routeProjectId was already truthy), but it must
    // keep working after the fix.
    await expect(page).toHaveURL(new RegExp(`projectId=${PROJECTS.riversideSchool.id}`));
    await expect(page.getByTestId("schedule-breadcrumb")).toContainText(PROJECTS.riversideSchool.name);

    // Direction 2, THE REGRESSION: a bare /schedule, with no ?projectId= at
    // all -- exactly what the nav's own "Schedule" link, a bookmark, or a
    // typed URL produces. Before this fix, resolveRouteProject() never read
    // the veri.rail.project cookie the switcher just wrote, so this always
    // rendered "Pick a project" regardless of the switch above -- the
    // "ignores the project switcher" bug the owner reported.
    await page.goto("/schedule");
    await expect(page.getByText("Pick a project")).toHaveCount(0);
    await expect(page.getByTestId("schedule-breadcrumb")).toContainText(PROJECTS.riversideSchool.name);
  });
});
