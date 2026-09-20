import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT, fieldByLabel } from "./helpers";
import { USERS } from "./users";

// TIMEOUT SWEEP (2026-09-20, PROJEXA-E2E-001 sub-task, raw-grep hit list off
// R-95/PR #297): every `{ timeout: 1[0-5]_000 }` below is a real lazy-mount
// data load, or a create/submit-then-redirect-then-re-render cycle, through
// the VERIDIAN-proxy path (Timeline/Milestones/Scope & Change Orders) --
// raised to 30_000ms to match this suite's own established minimum for a
// network-dependent Playwright check. playwright.config.ts's actionTimeout/
// navigationTimeout are both already 30_000ms, raised for the identical
// documented CI-latency class (see that file's own comments, and the R-95
// boq-analysis-poll fix in e2e/sumeet-billing-milestones-env1.spec.ts /
// PR #297 for the full root-cause writeup). Assertions themselves are
// unchanged -- only the headroom given to a slow-but-correct upstream.

// Owner directive "Merge 6" follow-on coverage for the /workspace/[id] page
// (src/app/(app)/workspace/[id]/page.tsx, orchestrated by
// ProjectWorkspaceClient.tsx). sumeet-project-workspace-env1.spec.ts already
// covers role-visibility and header/nav wiring end to end -- this file adds
// the requirement-specific coverage for R-94 (Timeline vs Milestones as
// genuinely distinct sections), R-96/R-97 (Scope & Change Orders end to
// end), and R-98 (a real, still-open gap: no visible/linked BOQ revision
// results from an approved Change Order).
//
// Read directly before writing anything below: ProjectWorkspaceClient.tsx,
// MilestonesClient.tsx, ScheduleGanttClient.tsx, ChangeOrdersClient.tsx,
// ChangeOrderCreateClient.tsx, ChangeOrderObjectClient.tsx,
// workspace-visibility.ts, and (in compliance-tracker) src/lib/db/schema.ts
// around constructionChangeOrders / the BOQ revision chain.
const PROJECT_ID = DEFAULT_PROJECT.id;

test.describe("Sumeet R-94: Timeline and Milestones are two genuinely distinct sections", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  // Confirmed still true by reading ProjectWorkspaceClient.tsx directly
  // (its own inline comment above the "milestones" section repeats the same
  // rule): #timeline and #milestones are two separate <section> blocks, each
  // wrapping its own unchanged real component (ScheduleGanttClient /
  // MilestonesClient) -- never a single section with a tab-switcher between
  // the two.
  //
  // A real strict-mode trap the existing workspace spec already documents
  // (its own header comment) is doubly true for Timeline specifically: the
  // outer wrapper's own CardTitle says "Timeline", AND ScheduleGanttClient
  // itself renders a SECOND, independent Card further down with its own
  // CardTitle also reading "Timeline" (the SVAR gantt-chart card -- see
  // ScheduleGanttClient.tsx around its final `<Card>...<CardTitle>Timeline`
  // block). An unscoped `container.getByText("Timeline", {exact:true})`
  // inside #timeline therefore matches TWO elements and throws a strict-mode
  // violation. The selectors below scope to the section's own immediate
  // wrapper Card (`data-slot="card"` / `"card-header"` / `"card-title"` are
  // shadcn's own real attributes, confirmed in src/components/ui/card.tsx)
  // via a direct-child combinator from the section id, which only the
  // OUTER wrapper Card can satisfy -- ScheduleGanttClient's own inner
  // "Timeline" card lives several levels deeper, inside CardContent, so it
  // never matches this selector.
  function ownSectionHeading(page: import("@playwright/test").Page, sectionId: string) {
    return page.locator(`#${sectionId} > [data-slot="card"] > [data-slot="card-header"] [data-slot="card-title"]`);
  }

  test("owner: #timeline and #milestones render as separate sections with their own headings, never a shared tab control", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });

    const timelineSection = page.locator("#timeline");
    const milestonesSection = page.locator("#milestones");
    await expect(timelineSection).toHaveCount(1);
    await expect(milestonesSection).toHaveCount(1);

    // Not one nested inside the other (rules out a tab-switcher where one
    // panel's content sits inside the other's hidden container), and no
    // shared Radix Tabs / tablist control wraps THE TWO OF THEM specifically.
    // CORRECTED (this run): unscoped page.getByRole("tablist") is a false
    // positive on this page -- Resources and Records each legitimately use
    // a real Tabs control of their own (WorkspaceResourcesCard/
    // WorkspaceRecordsCard), so the page can have 1-2 real tablists that
    // have nothing to do with Timeline/Milestones. Scope to a tablist that
    // is actually an ancestor of BOTH sections, which is the only shape a
    // real Timeline/Milestones tab-switcher regression could take.
    await expect(page.locator("#timeline #milestones")).toHaveCount(0);
    await expect(page.locator("#milestones #timeline")).toHaveCount(0);
    await expect(page.locator('[role="tablist"]').filter({ has: page.locator("#timeline") }).filter({ has: page.locator("#milestones") })).toHaveCount(0);

    await expect(ownSectionHeading(page, "timeline"), "Timeline must render its own section heading").toHaveText("Timeline");
    await expect(ownSectionHeading(page, "milestones"), "Milestones must render its own section heading, distinct from Timeline's").toHaveText("Milestones");

    // Each section really mounts its own real, different component (not two
    // empty placeholder shells wearing different titles): Timeline shows
    // ScheduleGanttClient's own "All tasks (N)" table heading, Milestones
    // shows MilestonesClient's own "New Milestone" create control.
    await timelineSection.scrollIntoViewIfNeeded();
    await expect(timelineSection.getByText(/All tasks \(\d+/)).toBeVisible({ timeout: 30_000 });
    await milestonesSection.scrollIntoViewIfNeeded();
    await expect(milestonesSection.getByRole("button", { name: /new milestone/i })).toBeVisible({ timeout: 30_000 });
  });

  test.describe("client_viewer also sees both, per workspace-visibility.ts's CLIENT_VIEWER list", () => {
    test.use({ storageState: "playwright/.auth/clientViewer.json" });

    test("client_viewer: #timeline and #milestones both render as distinct sections", async ({ page }) => {
      await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
      await expect(ownSectionHeading(page, "timeline"), "client_viewer must see Timeline (workspace-visibility.ts CLIENT_VIEWER)").toHaveText("Timeline");
      await expect(ownSectionHeading(page, "milestones"), "client_viewer must see Milestones (workspace-visibility.ts CLIENT_VIEWER)").toHaveText("Milestones");
      await expect(page.locator('[role="tablist"]').filter({ has: page.locator("#timeline") }).filter({ has: page.locator("#milestones") }), "still no shared tab control for client_viewer either").toHaveCount(0);
    });
  });
});

test.describe("Sumeet R-96/R-97: Scope & Change Orders works end to end from the embedded workspace card", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("the embedded card renders the SAME real change orders the API returns, or an honest empty state", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#scope-change-orders");
    // Sections mount lazily (LazyMount) -- scroll to it first, same pattern
    // the existing workspace spec's Billing Milestones/Insights tests use.
    const [changeOrdersRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/change-orders") && r.request().method() === "GET" && !r.url().includes("signature-status")),
      section.scrollIntoViewIfNeeded(),
    ]);
    const body = await changeOrdersRes.json();
    const changeOrders: Array<{ id: string; number: number; title: string }> = body.changeOrders ?? [];

    if (changeOrders.length === 0) {
      await expect(section.getByText("No change orders yet.")).toBeVisible();
    } else {
      for (const co of changeOrders.slice(0, 5)) {
        await expect(section.getByText(`CO-${co.number}`, { exact: true }), `row for CO-${co.number} must really render inside the embedded card`).toBeVisible();
      }
    }
    // The create control is always offered regardless of how many rows exist.
    await expect(section.getByRole("button", { name: /new change order/i })).toBeVisible();
  });

  test("clicking an existing change order opens its real Object Page", async ({ page }) => {
    const listRes = await page.request.get(`/api/change-orders?projectId=${PROJECT_ID}`);
    expect(listRes.ok(), `GET /api/change-orders => ${listRes.status()}`).toBe(true);
    const { changeOrders } = await listRes.json();
    test.skip(!changeOrders?.length, "no change order exists yet for this project to click through");
    const first = changeOrders[0];

    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#scope-change-orders");
    await section.scrollIntoViewIfNeeded();
    await section.getByText(`CO-${first.number}`, { exact: true }).click();

    await expect(page, "clicking a row must be a real navigation to that change order's own Object Page, not a modal").toHaveURL(new RegExp(`/change-orders/${first.id}$`));
    // ObjectScreen renders `title` inside a real <h1> (confirmed by reading
    // node_modules/@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx).
    await expect(page.getByRole("heading", { name: new RegExp(`^CO-${first.number}\\b`) })).toBeVisible({ timeout: 30_000 });
  });

  test("a real Scope & Change Order can be created and submitted for e-signature approval, end to end from the workspace page (R-96, R-97)", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#scope-change-orders");
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("button", { name: /new change order/i }).click();

    // ChangeOrdersClient.tsx's "New Change Order" is a REAL route change
    // (router.push to /change-orders/new?projectId=...), not a modal -- this
    // test follows it there to complete the flow, same as it would for a
    // real user.
    await expect(page).toHaveURL(new RegExp(`/change-orders/new\\?projectId=${PROJECT_ID}`));

    const title = `Workspace embed CO ${Date.now()}`;
    // ChangeOrderCreateClient's fields are all built on the shared FormField
    // primitive (src/components/ui/form-field.tsx), which DOES associate
    // Label->Input via a real htmlFor/id pair (unlike the plain
    // <Label>/<Input> pattern documented in helpers.ts's fieldByLabel
    // comment) -- so getByLabel works here.
    await page.getByLabel("Title").fill(title);
    await page.getByLabel(/Reason/i).fill("Owner directive Merge 6 -- scope-of-work change, E2E coverage");
    await page.getByLabel(/Cost Impact/i).fill("15000");
    await page.getByLabel(/Schedule Impact/i).fill("5");
    await page.getByRole("button", { name: /^save$/i }).click();

    // ChangeOrderCreateClient's real create -> router.push(`/change-orders/${data.id}`).
    await expect(page).toHaveURL(/\/change-orders\/[a-zA-Z0-9_-]+$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible({ timeout: 30_000 });

    // Submit for approval -- the real e-signature dispatch path (R-97: a
    // change of scope must work end to end). This is as far as the flow can
    // go from this spec: ChangeOrderObjectClient.tsx's own header comment
    // states approve/reject happens ONLY via a real external signer
    // completing/declining an actual e-signature link, "never a button
    // here" -- there is no Approve/Reject control anywhere in this app for
    // this spec to click (re-confirmed directly below in the client_viewer
    // describe block).
    await page.getByRole("button", { name: /send for approval/i }).click();
    // Signer name / Signer email are a bare <Label>/<Input> pair with no
    // htmlFor (confirmed by reading ChangeOrderObjectClient.tsx directly) --
    // the systemic gap helpers.ts's fieldByLabel() exists for.
    await fieldByLabel(page.locator("body"), "Signer name").fill(USERS.ceo.name);
    await fieldByLabel(page.locator("body"), "Signer email").fill(USERS.ceo.email);
    await page.getByRole("button", { name: /^send$/i }).click();

    // R-97 FIXED (2026-09-19, Owner-authorized). Was: compliance-tracker's
    // PATCH /api/v1/projexa/change-orders/[id] (action:"submit") refused
    // with 400 "Submitting for approval requires a real user session, not
    // an API key" for EVERY PROJEXA-proxied call, 100% reproducibly --
    // ctx.dbUser is unconditionally null on that path (auth-guard.ts's fast
    // API-key path, ~line 424), so "Send for Approval" could never succeed
    // from PROJEXA's real UI for any user, on any change order. Fixed by
    // threading the same acting-user-resolution pattern
    // cost-visibility-service.ts's resolveRoleForCostVisibility() already
    // uses (X-Acting-User / X-Acting-User-Email -> resolveActingUser() ->
    // a real compliance.users row) into this route and
    // submitChangeOrderForApproval(), on both sides of the proxy (PROJEXA's
    // own PATCH now forwards ctx.user's id/email; compliance-tracker's PATCH
    // now resolves them instead of requiring ctx.dbUser directly).
    await expect(page.getByText("Sent for e-signature approval")).toBeVisible({ timeout: 30_000 });
    // co.status.replace(/_/g, " ") => "pending approval" (ChangeOrderObjectClient.tsx).
    await expect(page.getByText(/pending approval/i)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Sumeet: client_viewer and the Scope & Change Orders section (Owner spec: client_viewer decides on change orders)", () => {
  test.use({ storageState: "playwright/.auth/clientViewer.json" });

  test("client_viewer sees the Scope & Change Orders section, but there is no Approve/Reject control anywhere on this page", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#scope-change-orders");
    await expect(section, "client_viewer must see Scope & Change Orders (workspace-visibility.ts CLIENT_VIEWER)").toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole("button", { name: /new change order/i })).toBeVisible({ timeout: 30_000 });

    // HONEST NEGATIVE FINDING, not a faked pass: the Owner spec says
    // client_viewer are "the ones who DECIDE on change orders", but reading
    // ChangeOrderObjectClient.tsx directly shows the real lifecycle is
    // Draft -> "Send for Approval" (dispatches a real e-signature request)
    // -> the signature-status list renders read-only once pending. Its own
    // header comment: "approve/reject only ever happens via an actual
    // signer completing/declining, never a button here." There is
    // therefore no Approve/Reject UI control for ANY role -- including
    // client_viewer -- to click; a client_viewer's real "decision" happens
    // by being the signer on the external e-signature link, which is a
    // different surface entirely and out of reach for this spec (same class
    // of BLOCKED reasoning already used for the demo-login/chat-assistant
    // rows in platform.sumeet_requirements).
    await expect(page.getByRole("button", { name: /^approve$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^reject$/i })).toHaveCount(0);
  });
});

test.describe("Sumeet R-98 FIXED (2026-09-19, Owner-authorized): an approved Change Order can now be linked to the BOQ revision it caused", () => {
  test.use({ storageState: "playwright/.auth/finance.json" });

  // Prior state (kept here for history, not re-asserted): constructionChangeOrders.boqRevisionId
  // (schema.ts ~11920) existed as a column but nothing in the write path
  // ever populated it, and ChangeOrderObjectClient.tsx had no BOQ facet or
  // control at all. Fixed end to end: construction-boq-service.ts's
  // createBoqRevision() now accepts an optional sourceChangeOrderId (only
  // for an ALREADY-APPROVED change order, and only once per change order --
  // both enforced server-side, verified below), and
  // ChangeOrderObjectClient.tsx's new "approved" block offers a real
  // "Create BOQ Revision from this Change Order" button when unlinked, or
  // a real link to the resulting revision once one exists.
  test("creating a BOQ revision from an approved Change Order sets boqRevisionId, end to end through the real UI", async ({ page }) => {
    const listRes = await page.request.get(`/api/change-orders?projectId=${PROJECT_ID}`);
    expect(listRes.ok(), `GET /api/change-orders => ${listRes.status()}`).toBe(true);
    const { changeOrders } = await listRes.json();
    const approved = (changeOrders ?? []).find((c: { status: string; boqRevisionId: string | null }) => c.status === "approved" && !c.boqRevisionId);
    test.skip(!approved, "no already-approved, not-yet-linked change order exists in this project's seed data to drive this flow against");

    const boqRes = await page.request.get(`/api/reports/boq-analysis?projectId=${PROJECT_ID}`);
    test.skip(!boqRes.ok(), "boq-analysis must be reachable to resolve the project's current BOQ");
    const { row } = await boqRes.json();
    test.skip(!row?.boqId, "no approved BOQ exists for this project -- the revise flow has nothing to revise");

    await page.goto(`/change-orders/${approved.id}`, { waitUntil: "networkidle" });
    await expect(page.getByText("This approved change has not yet been carried into a BOQ revision.")).toBeVisible();

    await page.getByRole("button", { name: /create boq revision from this change order/i }).click();
    await expect(page).toHaveURL(new RegExp(`/scope/${row.boqId}/revise\\?fromChangeOrder=${approved.id}`));
    await expect(page.getByTestId("revise-linked-change-order-banner"), "the revise screen must visibly confirm the link it's about to create").toBeVisible();

    await page.getByLabel(/Revision Title/i).fill(`R-98 link spec ${Date.now()}`);
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page).toHaveURL(/\/scope\/[a-zA-Z0-9_-]+$/, { timeout: 30_000 });
    const newBoqId = page.url().split("/scope/")[1];

    // Direct, timing-independent confirmation: the change order's own
    // record now carries the real link.
    const detailRes = await page.request.get(`/api/change-orders/${approved.id}`);
    expect(detailRes.ok()).toBe(true);
    const detail = await detailRes.json();
    expect(detail.boqRevisionId, "R-98: the approved change order's boqRevisionId must now point at the revision just created").toBe(newBoqId);

    // And the Object Page itself now shows the real link instead of the button.
    await page.goto(`/change-orders/${approved.id}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: /create boq revision from this change order/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /a boq revision/i })).toBeVisible();
  });

  test("a change order that is not yet approved cannot be linked (server-side guard, not just a hidden UI control)", async ({ page }) => {
    const listRes = await page.request.get(`/api/change-orders?projectId=${PROJECT_ID}`);
    expect(listRes.ok()).toBe(true);
    const { changeOrders } = await listRes.json();
    const notApproved = (changeOrders ?? []).find((c: { status: string }) => c.status !== "approved");
    test.skip(!notApproved, "every change order in this project's seed data is already approved -- nothing to test this guard against");

    const boqRes = await page.request.get(`/api/reports/boq-analysis?projectId=${PROJECT_ID}`);
    const { row } = await boqRes.json();
    test.skip(!row?.boqId, "no approved BOQ exists for this project");

    const res = await page.request.post(`/api/scope/${row.boqId}/revisions`, {
      data: { title: "Should be refused", sourceChangeOrderId: notApproved.id },
    });
    expect(res.status(), "createBoqRevision must refuse to link a change order that is not approved").toBe(400);
  });

  test("a change order already linked to a revision cannot be linked to a second one", async ({ page }) => {
    const listRes = await page.request.get(`/api/change-orders?projectId=${PROJECT_ID}`);
    expect(listRes.ok()).toBe(true);
    const { changeOrders } = await listRes.json();
    const alreadyLinked = (changeOrders ?? []).find((c: { status: string; boqRevisionId: string | null }) => c.status === "approved" && c.boqRevisionId);
    test.skip(!alreadyLinked, "no already-linked change order exists yet in this project's seed data -- run after the first test in this file to get one");

    const boqRes = await page.request.get(`/api/reports/boq-analysis?projectId=${PROJECT_ID}`);
    const { row } = await boqRes.json();
    test.skip(!row?.boqId, "no approved BOQ exists for this project");

    const res = await page.request.post(`/api/scope/${row.boqId}/revisions`, {
      data: { title: "Should be refused, already linked", sourceChangeOrderId: alreadyLinked.id },
    });
    expect(res.status(), "createBoqRevision must refuse to re-link a change order that already has a boqRevisionId").toBe(409);
  });
});
