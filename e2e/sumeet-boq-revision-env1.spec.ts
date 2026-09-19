import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// Sumeet requirements R-20/R-21 ("revision preserves parent links and
// breakdown %", "revision variation vs prior shown") and R-97/R-98
// ("change of scope of work must work end-to-end", "BOQ must
// change/track when scope of work changes") -- CLOSED in the register
// with no committed Playwright spec (R-20/R-21 have a real Bun
// route.test.ts; R-97/R-98 had null evidence entirely). GAP FOUND
// (2026-09-19, Playwright gap-closure Round 4): the real BOQ-revision
// write path (POST /api/scope/[id]/revisions, GET /api/scope/[id]/compare)
// had zero browser-level coverage.
const PROJECT_ID = DEFAULT_PROJECT.id;
const ROOT_CODE = `R4-ROOT-${Date.now()}`;

test.use({ storageState: "playwright/.auth/ceo.json" });

test("Sumeet R-20/R-21/R-97/R-98: revising a BOQ preserves line links, shows real variance, and supersedes the prior version", async ({ page }) => {
  // 1. Real BOQ: one root line.
  const createRes = await page.request.post("/api/scope", {
    data: {
      projectId: PROJECT_ID,
      title: `R4 revision spec ${Date.now()}`,
      lineItems: [{ itemCode: ROOT_CODE, description: "R4 revision spec root", unit: "sqm", quantity: 100, rate: 50 }],
    },
  });
  expect(createRes.ok(), "BOQ creation must succeed for this spec's own setup").toBe(true);
  const created = await createRes.json();
  const parentBoqId: string = created.id;
  const parentRootLine = (created.lineItems as Array<{ id: string; itemCode: string }>).find((l) => l.itemCode === ROOT_CODE);
  expect(parentRootLine, "the real root line must come back from the create response").toBeTruthy();

  // 2. A real activity (required by POST /api/work-progress -- same
  // prerequisite the R-41/R-42/R-43 spec already establishes).
  const activityRes = await page.request.post("/api/work-progress/activities", {
    data: { projectId: PROJECT_ID, name: `R4 revision spec activity ${Date.now()}` },
  });
  expect(activityRes.ok(), "activity creation must succeed for this spec's own setup").toBe(true);
  const activityBody = await activityRes.json();
  const activityId: string | undefined = activityBody.id ?? activityBody.activity?.id;
  expect(activityId, "the real activity id must come back from the create response").toBeTruthy();

  // 3. Real recorded progress against the root line, so the revision below
  // exercises the REAL scope-reduction guard (R-22/R-23), not just an
  // unconditional revision.
  const progressRes = await page.request.post("/api/work-progress", {
    data: {
      projectId: PROJECT_ID, boqId: parentBoqId, boqLineItemId: parentRootLine!.id, activityId,
      entryDate: new Date().toISOString().slice(0, 10), quantityDone: 40, percentComplete: 40, entryBasis: "DELTA",
    },
  });
  expect(progressRes.ok(), "logging real progress must succeed for this spec's own setup").toBe(true);

  // 4. R-22/R-23: a revision that REDUCES this line's quantity below what
  // progress has already recorded against it must be BLOCKED (409), not
  // silently applied -- the real, named business rule, not a client-side
  // guess.
  const blockedRevisionRes = await page.request.post(`/api/scope/${parentBoqId}/revisions`, {
    data: { lineItems: [{ itemCode: ROOT_CODE, description: "R4 revision spec root", unit: "sqm", quantity: 20, rate: 50 }] },
  });
  expect(blockedRevisionRes.status(), "reducing a line's quantity below its own recorded progress must be refused, not silently applied").toBe(409);
  const blockedBody = await blockedRevisionRes.json();
  expect(Array.isArray(blockedBody.conflicts) && blockedBody.conflicts.length > 0, "the 409 must name the real conflicting line(s), not just a prose sentence").toBe(true);

  // 5. A genuine, real revision: qty INCREASES (no conflict), so this one
  // must succeed and create a real, linked child BOQ.
  const revisionRes = await page.request.post(`/api/scope/${parentBoqId}/revisions`, {
    data: { lineItems: [{ itemCode: ROOT_CODE, description: "R4 revision spec root", unit: "sqm", quantity: 150, rate: 50 }] },
  });
  expect(revisionRes.ok(), "a genuine, non-conflicting revision must succeed").toBe(true);
  const revision = await revisionRes.json();
  const childBoqId: string = revision.id;
  expect(revision.parentBoqId, "the child revision must record its real parentBoqId link").toBe(parentBoqId);
  expect(revision.version, "the child revision's version must be exactly one more than its parent's").toBe((created.version ?? 1) + 1);

  // 6. R-21: the real variance between this revision and its parent, from
  // the same /compare endpoint the Object Page's own Revisions tab reads.
  const compareRes = await page.request.get(`/api/scope/${childBoqId}/compare`);
  expect(compareRes.ok(), "the real compare endpoint must succeed for a genuine parent/child pair").toBe(true);
  const comparison = await compareRes.json();
  const changedRoot = (comparison.changed as Array<{ current: { itemCode: string }; previous: { itemCode: string } }>).find(
    (c) => c.current.itemCode === ROOT_CODE
  );
  expect(changedRoot, "the compare response's own changed[] must name this spec's real root line").toBeTruthy();
  // 100 sqm x AED 50 -> 150 sqm x AED 50: a real +2500 variance, not a
  // placeholder or a zero.
  expect(comparison.totalVariation, "the real total variation must reflect the real qty increase (50 extra sqm x AED 50/sqm = 2500)").toBeCloseTo(2500, 2);

  // 7. R-52: only the LATEST revision is counted -- the parent must now
  // report status "superseded" when re-read for real.
  const parentReread = await page.request.get(`/api/scope/${parentBoqId}`);
  expect(parentReread.ok(), "re-reading the parent BOQ after its own revision must succeed").toBe(true);
  const parentBody = await parentReread.json();
  expect(parentBody.status, "the parent must be marked superseded once a real child revision exists").toBe("superseded");
});

test("Sumeet R-20: a second attempt to revise an already-revised BOQ is refused, naming the existing revision", async ({ page }) => {
  const createRes = await page.request.post("/api/scope", {
    data: { projectId: PROJECT_ID, title: `R4 double-revision spec ${Date.now()}`, lineItems: [{ description: "root", unit: "sqm", quantity: 10, rate: 10 }] },
  });
  expect(createRes.ok()).toBe(true);
  const created = await createRes.json();

  const firstRevision = await page.request.post(`/api/scope/${created.id}/revisions`, { data: {} });
  expect(firstRevision.ok(), "the first revision (copy-forward, no changes) must succeed").toBe(true);

  const secondRevision = await page.request.post(`/api/scope/${created.id}/revisions`, { data: {} });
  expect(secondRevision.status(), "a SECOND revision of the SAME already-revised parent must be refused, not create a sibling").toBe(409);
  const body = await secondRevision.json();
  expect(body.error, "the refusal must name the existing revision, not just say 'conflict'").toMatch(/already been revised/i);
});
