import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { buildShellData } from "../context";
import { toShellManifest } from "../manifest-cache";
import type { DurableIdentity } from "../../identity";
import { loadReview, loadTimeEntryNew, loadTimesheet } from "./design-change-adapter";
import { TASKS_KIND, TIMESHEETS_KIND } from "./design-change-rows";
import { dcShellData, entryRow, seedDesignChange, taskRow } from "./design-change-test-fixtures";

// lf-e10b, found in a real Chromium (e2e/lf-documents-design-change.spec.ts): the server writes a time entry's user_id as the person's
// VERIDIAN id (compliance.users.id: the pipeline executor records `actor.id`), while the laptop knows the person by their SIGN-IN id
// (the manifest's user.auth_user_id). The design studio compared user_id with the sign-in id only, so every entry the person had
// logged ONLINE was missing from "my timesheet", left out of the day's 24-hour rule, and, on the review screen, their own submitted
// day looked like someone else's (offered for them to approve). The laptop must know both ids and treat either as "mine".

const SIGN_IN = "u1";
const PERSON = "clfperson000000000000000001";
const DAY = "2026-10-02";

async function seeded() {
  const idb = new IDBFactory();
  await seedDesignChange(idb, SIGN_IN, [
    { kind: TASKS_KIND, projectId: "p1", data: taskRow("i1", 7, "Lobby concept") },
    // logged online: the server wrote the VERIDIAN id
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t-mine", { user_id: PERSON, hours: "3.5", spent_on: DAY, approval_status: "submitted" }) },
    // a colleague's
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t-other", { user_id: "clfcolleague000000000000001", hours: "6", spent_on: DAY, approval_status: "submitted" }) },
  ]);
  return idb;
}

test("the cached manifest keeps the VERIDIAN person id next to the sign-in id, and the shell's data carries it", () => {
  const manifest = toShellManifest({ user: { id: PERSON, auth_user_id: SIGN_IN, name: "Lina", role: "member", org_id: "orgA" }, projects: [], kinds: [] }, 1);
  expect(manifest.user.id).toBe(SIGN_IN);
  expect(manifest.user.personId).toBe(PERSON);
  const identity: DurableIdentity = { userId: SIGN_IN, email: "l@x.test", name: "Lina", orgId: "orgA", role: "member", lastRefreshAt: 1, signedInAt: 1, session: { access_token: "a", refresh_token: "r", expires_at: 1 } };
  expect(buildShellData({ identity, replica: null, names: manifest }).personId).toBe(PERSON);
});

test("an entry the server wrote under the person's VERIDIAN id is MINE: shown on my timesheet and counted in the day's hours", async () => {
  const idb = await seeded();
  const data = { ...dcShellData(idb, SIGN_IN, "member"), personId: PERSON };
  const sheet = await loadTimesheet(data, "p1", DAY);
  if (sheet.state !== "local") throw new Error(`expected a local sheet, got ${sheet.state}`);
  expect(sheet.entries.map((e) => e.id)).toEqual(["t-mine"]);
  const create = await loadTimeEntryNew(data, "p1", DAY, null);
  if (create.state !== "ready") throw new Error("expected ready");
  expect(create.myHoursByDay[DAY]).toBe(3.5);
});

test("on the review screen my own submitted day is marked as mine (self), a colleague's is not", async () => {
  const idb = await seeded();
  const review = await loadReview({ ...dcShellData(idb, SIGN_IN, "manager"), personId: PERSON }, "p1");
  if (review.state !== "local") throw new Error("expected local");
  expect(review.groups.map((g) => [g.userId, g.self])).toEqual([["clfcolleague000000000000001", false], [PERSON, true]]);
});
