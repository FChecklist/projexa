import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  DELIVERY_KIND_NAMES, PROJECT_ID, goOffline, goOnline, noCrash as checkNoCrash, openScreen, prepareDeliveryLaptop, prepareFinishedAfterMs, readMeta, today, watchConsole,
  type ExtraProject, type Net, type Prepared,
} from "./support/lf-delivery-stub";

// LOCAL-FIRST, package lf-e10a: every delivery screen of the on-laptop shell (src/lib/local-first/shell/clusters/delivery.ts) opened in a
// real Chromium with the network OFF: the object screens and the tabs with their real values, what a read-only role sees (the values,
// money "hidden for your role", and NO write control), the calm empty and "not finished copying" states, and the create/import pages only
// the server can do (calm offline, the server's page online). Same set-up and rules as lf-delivery-offline.spec.ts (see its header).

const q = `?projectId=${PROJECT_ID}`;
const TODAY = today();
const EMPTY: ExtraProject = { id: "lf-dl-project-empty", name: "Annexe Kiosk", mode: "empty" };
const UNSYNCED: ExtraProject = { id: "lf-dl-project-late", name: "Marina Lobby", mode: "unsynced" };

const noCrash = (page: Page, problems: string[]) => checkNoCrash(page, problems, expect);
const open = (page: Page, path: string, testId: string, state = "local") => openScreen(page, path, testId, expect, state);

async function offlineLaptop(page: Page, context: BrowserContext, role: string, extra: ExtraProject[] = []): Promise<Prepared & { net: Net; problems: string[] }> {
  const net: Net = { mode: "up" };
  const problems = watchConsole(page);
  const prepared = await prepareDeliveryLaptop(page, context, net, role, expect, extra);
  await goOffline(context, net, prepared.app);
  problems.length = 0;
  return { ...prepared, net, problems };
}

test("member, offline: the object screens and the tabs show their real values", async ({ page, context }) => {
  const { problems } = await offlineLaptop(page, context, "member");

  await test.step("a progress entry: its line, quantity, percent, remarks", async () => {
    await open(page, `/work-progress/prog-1${q}`, "work-progress-entry");
    const s = page.getByTestId("work-progress-entry");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Progress entry · 2026-09-28");
    await expect(s).toContainText("Interior fit-out");
    await expect(s).toContainText("HV-101");
    await expect(s).toContainText("48");
    await expect(s).toContainText("10%");
    await expect(s).toContainText("East wing first fix");
    await noCrash(page, problems);
  });

  await test.step("an entry that is not on the laptop: said calmly", async () => {
    await open(page, `/work-progress/prog-404${q}`, "work-progress-entry", "not_found");
    await noCrash(page, problems);
  });

  await test.step("work progress Analytics and Report: the server's calculations, with the laptop's own CSV", async () => {
    await open(page, `/work-progress${q}&tab=analytics`, "work-progress");
    await expect(page.getByTestId("work-progress-analytics")).toContainText("recalculated when online");
    await expect(page.getByTestId("server-only")).toContainText("It will be available here when you are connected.");
    await open(page, `/work-progress${q}&tab=report`, "work-progress");
    await expect(page.getByTestId("work-progress-report")).toContainText("Work Progress Report");
    const download = page.waitForEvent("download");
    await page.getByTestId("work-progress-csv").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`work-progress-${PROJECT_ID}-${TODAY}.csv`);
    const csv = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
    expect(csv).toContain("2026-09-30");
    expect(csv).toContain("East wing first fix");
    await noCrash(page, problems);
  });

  await test.step("a worker and their attendance; the daily summary", async () => {
    await open(page, `/labour/w-1${q}`, "labour-worker");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ravi Kumar");
    await expect(page.getByTestId("labour-worker")).toContainText("HV-W01");
    await expect(page.getByTestId("labour-worker")).toContainText("950.00");
    await expect(page.getByTestId("labour-worker-attendance-row")).toHaveCount(1);
    await expect(page.getByTestId("labour-worker-attendance-row")).toContainText(TODAY);
    await open(page, `/labour${q}&tab=summary`, "labour");
    await expect(page.getByTestId("labour-summary")).toContainText(`Today (${TODAY}): 1 present, 0 half day, 0 absent, 1 marked of 2 active workers.`);
    await noCrash(page, problems);
  });

  await test.step("a material and its movements; a voided receipt says so; the cost report is the server's", async () => {
    await open(page, `/materials/mat-1${q}`, "material");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gypsum board 12.5 mm");
    await expect(page.getByTestId("material-movements")).toContainText("DN-4471");
    await open(page, `/materials/receipts/rcp-3${q}`, "material-receipt");
    await expect(page.getByTestId("material-receipt-voided")).toHaveText("Voided: Wrong board thickness");
    await open(page, `/materials/receipts/rcp-2${q}`, "material-receipt");
    await expect(page.getByTestId("material-receipt")).toContainText("Two drums dented");
    await expect(page.getByTestId("material-receipt")).toContainText("142.00");
    await open(page, `/materials${q}&tab=cost-report`, "materials");
    await expect(page.getByTestId("materials-cost-report")).toContainText("recalculated when online");
    await noCrash(page, problems);
  });

  await test.step("the schedule: milestones, a task with its milestone, the tabs that are the server's", async () => {
    await open(page, `/schedule${q}&tab=milestones`, "schedule");
    await expect(page.getByTestId("schedule-milestones")).toHaveText("2026-11-15 · Level 3 handover · pending");
    await open(page, `/schedule${q}`, "schedule");
    await expect(page.getByTestId("schedule-critical-note")).toContainText("Baselines on file: Baseline A");
    await open(page, `/schedule/tasks/t-2${q}`, "schedule-task");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("#2 Ceiling paint");
    await expect(page.getByTestId("schedule-task")).toContainText("Level 3 handover · 2026-11-15");
    await open(page, `/schedule/tasks/t-3${q}`, "schedule-task", "not_found"); // archived: not shown
    for (const tab of ["board", "sprints", "timesheet"]) {
      await open(page, `/schedule${q}&tab=${tab}`, "schedule");
      await expect(page.getByTestId(`schedule-${tab}`)).toBeVisible();
    }
    await noCrash(page, problems);
  });
});

test("viewer, offline: the same values, money hidden for the role, and not one write control", async ({ page, context }) => {
  const { problems } = await offlineLaptop(page, context, "viewer");

  await test.step("work progress: the entries, and a note instead of the entry form", async () => {
    await open(page, `/work-progress${q}`, "work-progress");
    await expect(page.getByTestId("work-progress-row")).toHaveCount(2);
    await expect(page.getByTestId("delivery-read-only")).toHaveText("Your role can see this but not change it.");
    await expect(page.getByTestId("work-progress-form")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save entry" })).toHaveCount(0);
    await noCrash(page, problems);
  });

  await test.step("labour: rates hidden, no 'Mark attendance', no mark buttons, the form says why", async () => {
    await open(page, `/labour${q}`, "labour");
    await expect(page.getByTestId("labour-roster-row").filter({ hasText: "Ravi Kumar" })).toContainText("Hidden for your role");
    await expect(page.getByText("950.00")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Mark attendance" })).toHaveCount(0);
    await open(page, `/labour/attendance/${TODAY}${q}`, "labour-attendance-sheet");
    await expect(page.getByTestId("labour-sheet-row")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^(Present|Half day|Absent)$/ })).toHaveCount(0);
    await open(page, `/labour/attendance/new${q}`, "labour-attendance-new");
    await expect(page.getByTestId("labour-attendance-form")).toHaveCount(0);
    await expect(page.getByTestId("delivery-read-only")).toBeVisible();
    await noCrash(page, problems);
  });

  await test.step("materials: cost hidden, no 'Record receipt' / 'Issue material', the forms say why", async () => {
    await open(page, `/materials${q}`, "materials");
    await expect(page.getByTestId("materials-row").filter({ hasText: "Gypsum board" })).toContainText("Hidden for your role");
    await expect(page.getByTestId("materials-row").filter({ hasText: "Gypsum board" })).toContainText("90");
    await expect(page.getByRole("link", { name: /^(Record receipt|Issue material)$/ })).toHaveCount(0);
    for (const [path, id] of [["/materials/receipts/new", "material-receipt-new"], ["/materials/issues/new", "material-issue-new"]] as const) {
      await open(page, `${path}${q}`, id);
      await expect(page.getByTestId("delivery-read-only")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
    }
    await noCrash(page, problems);
  });
});

test("empty project and a project that has not finished copying: calm, true words on every delivery screen", async ({ page, context }) => {
  const net: Net = { mode: "up" };
  const problems = watchConsole(page);
  const l = await prepareDeliveryLaptop(page, context, net, "member", expect, [EMPTY, UNSYNCED]);
  for (const kind of DELIVERY_KIND_NAMES) {
    await expect.poll(() => readMeta(page, `projexa-local:${l.session.userId}`, `sync:done:${EMPTY.id}:${kind}`), { timeout: 60_000, message: `the empty project's ${kind} never finished` }).toBeTruthy();
  }
  expect(await readMeta(page, `projexa-local:${l.session.userId}`, `sync:done:${UNSYNCED.id}:progress`), "a project whose pulls all fail must not be marked copied").toBeFalsy();
  // a project that cannot be copied must not hold the person on the first-run screen until its 3-minute ceiling (measured: ~6 s)
  expect(prepareFinishedAfterMs.at(-1)!, "the first-run screen waited for its ceiling instead of finishing").toBeLessThan(60_000);
  await goOffline(context, net, l.app);
  problems.length = 0;

  await test.step("empty: each list says there is nothing yet (not a crash, not 'not copied')", async () => {
    const e = `?projectId=${EMPTY.id}`;
    await open(page, `/work-progress${e}`, "work-progress");
    await expect(page.getByText("No progress recorded on this project yet.")).toBeVisible();
    await expect(page.getByTestId("work-progress-form-needs-server")).toHaveText("This project has no BOQ line on this laptop to record progress against.");
    await open(page, `/labour${e}`, "labour");
    await expect(page.getByText("No workers on the roster yet.")).toBeVisible();
    await open(page, `/materials${e}`, "materials");
    await expect(page.getByText("No materials on this project yet.")).toBeVisible();
    await open(page, `/materials/issues/new${e}`, "material-issue-new");
    await expect(page.getByText("No material has stock on hand on this laptop.")).toBeVisible();
    await open(page, `/schedule${e}`, "schedule");
    await expect(page.getByText("No task in this project's schedule yet.")).toBeVisible();
    await expect(page.getByTestId("local-shell-project")).toContainText(EMPTY.name);
    await noCrash(page, problems);
  });

  await test.step("not finished copying: each screen says so instead of showing an empty list", async () => {
    const u = `?projectId=${UNSYNCED.id}`;
    for (const [path, id] of [["/work-progress", "work-progress"], ["/labour", "labour"], ["/materials", "materials"], ["/schedule", "schedule"]] as const) {
      await open(page, `${path}${u}`, id, "not_synced");
      await expect(page.getByTestId(id)).toContainText("This project has not finished copying to this laptop yet.");
    }
    await noCrash(page, problems);
  });
});

test("create/import pages only the server can do: calm offline, the server's own page when connected", async ({ page, context }) => {
  const l = await offlineLaptop(page, context, "member");
  // G-15: /labour/new, /materials/new and /schedule/tasks/new are offline screens now (modules/*NewScreen.tsx, proven in delivery-screens.test.tsx); the roster import stays the server's
  const pages = [["/labour/import", "Importing a roster"]] as const;

  await test.step("offline: each says it is done on the server, no error", async () => {
    for (const [path, what] of pages) {
      await page.goto(`/local${path}${q}`);
      const s = page.getByTestId("delivery-server-only");
      await expect(s).toHaveAttribute("data-online", "0");
      await expect(s).toContainText(`${what} is done on the server for now. It will open when you are connected.`);
      await noCrash(page, l.problems);
    }
  });

  await test.step("online: the shell hands the page to the server (marked so the worker does not serve the shell back)", async () => {
    // the page still open from the offline loop ("Importing a roster") hands itself to the server as soon as the connection is back
    await goOnline(context, l.net, l.app);
    await expect(page).toHaveURL(new RegExp(`/labour/import\\?projectId=${PROJECT_ID}&px-server=1$`), { timeout: 30_000 });
    // and a fresh visit, online: the screen replaces the address at once, so the first navigation is aborted by the second (the hand-off)
    await page.goto(`/local/labour/import${q}`).catch((e: Error) => expect(e.message).toContain("ERR_ABORTED"));
    await expect(page).toHaveURL(new RegExp(`/labour/import\\?projectId=${PROJECT_ID}&px-server=1$`), { timeout: 30_000 });
  });
});
