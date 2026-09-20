import { test, expect } from "@playwright/test";
import { PROJECTS } from "./helpers";

test.use({ storageState: "playwright/.auth/siteSupervisor.json" });

// PROJEXA-E2E-001 section 5 item 7 (the last of the work order's 8 named
// broken screens). Owner's exact words: "Site Engineer project lock --
// Auto-locks to 'Business Bay Corporate HQ' instead of the seeded project.
// Tell me plainly: intentional role scoping or a bug?"
//
// PLAIN ANSWER, evidence below: NEITHER a deliberate role-scoping feature NOR
// a role-specific bug. It is the SAME generic, role-blind "auto" project
// fallback already diagnosed for /change-orders (#299) and /site-diary
// (#301) -- chooseProject()/pickProject() (src/lib/project-preference.ts)
// take no role parameter at all, GET /projects (compliance-tracker's
// listProjectsForSelection()) is queried by orgId only, and there is no
// project_assignment/project_member table anywhere in compliance-tracker's
// schema. Grepping "site_engineer" across src/lib/project-selection.ts,
// project-preference.ts, M24Shell.tsx's chooseProject(), and middleware.ts
// returns zero hits. Live-verified against this exact account (Manoj Yadav,
// site_engineer, "Meridian Construction Group (E2E Test Org)"): a fresh
// login with no stored `veri.rail.project` preference landed /site-diary on
// projectId=db0i9peek6gbjfltlfmduu7u ("E2E-BatchA-1784446620540 Test
// Project") -- the alphabetically-first ACTIVE project in this org by name
// (listProjectsForSelection's own `orderBy: asc(name)`), exactly the same
// "auto" fallback class, not a project chosen because of this account's
// role. The owner's own "Business Bay Corporate HQ" observation (a
// different org, "projexa_demo_org") is explained the same way: "Business
// Bay Corporate HQ - Full Renovation" sorts alphabetically before "Villa 21
// - Whitefield" (the richly-seeded project), confirmed via a direct
// Supabase query.
//
// This spec does NOT try to assert which project the "auto" fallback lands
// on -- PHASE2_BATCH_B_FINDINGS.md already documents that as inherently
// fragile in this shared, concurrently-written-to org (any write flow that
// creates a project can shift which one sorts first). Asserting that would
// make this spec flaky for a reason that has nothing to do with role
// scoping. Instead it proves the actual question the owner asked -- "is
// this role LOCKED to one project" -- directly: (a) an explicit deep link
// reaches ANY project in the org for this role, not just one, and (b) the
// top-rail switcher is not locked -- picking a different project updates
// the screen immediately and the choice survives a bare re-navigation to a
// different module, exactly like every other role (see e2e/
// schedule-project-switcher.spec.ts's identical proof for the `ceo` role).
test.describe("Site Engineer is not locked to one project", () => {
  test("an explicit ?projectId= deep link reaches any project in the org, not just one", async ({ page }) => {
    await page.goto(`/site-diary?projectId=${PROJECTS.riversideSchool.id}`);
    await expect(
      page.getByRole("button", { name: new RegExp(`Project: ${PROJECTS.riversideSchool.name}`) })
    ).toBeVisible();

    await page.goto(`/site-diary?projectId=${PROJECTS.highwayWarehouse.id}`);
    await expect(
      page.getByRole("button", { name: new RegExp(`Project: ${PROJECTS.highwayWarehouse.name}`) })
    ).toBeVisible();
  });

  test("the top-rail switcher is not locked -- switching projects updates immediately and survives a bare re-navigation", async ({
    page,
  }) => {
    // Start from a known project via a deep link.
    await page.goto(`/site-diary?projectId=${PROJECTS.emeraldBusinessPark.id}`);
    const switcherButton = page.getByRole("button", { name: /Click to switch project\.$|^No project selected\./ });
    await expect(switcherButton).toHaveAccessibleName(new RegExp(PROJECTS.emeraldBusinessPark.name));

    // Open the switcher and pick a DIFFERENT project.
    await switcherButton.click();
    const listbox = page.getByRole("listbox", { name: "Switch project" });
    await expect(listbox).toBeVisible();
    await listbox.getByRole("option", { name: PROJECTS.meridianHeights.name }).click();
    await expect(switcherButton).toHaveAccessibleName(new RegExp(PROJECTS.meridianHeights.name));

    // A bare re-navigation to a DIFFERENT module, with no ?projectId= at
    // all -- exactly what clicking "Work Progress" in the nav produces.
    // If this role were genuinely locked to a fixed project, this is where
    // it would show: the choice above would be silently discarded and the
    // screen would revert to whichever project the lock names. It does not
    // -- the remembered choice (the same `veri.rail.project` cookie every
    // other role's switcher writes) still applies.
    await page.goto("/work-progress");
    await expect(switcherButton).toHaveAccessibleName(new RegExp(PROJECTS.meridianHeights.name));
  });
});
