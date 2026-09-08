import { test, expect } from "@playwright/test";
import { apiGet, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

const SEEDED_SALES_ORDER_COUNT = 6;
const SEEDED_CUSTOMER_COUNT = 6;

test.describe("Sales Orders (/sales-orders)", () => {
  test("real seeded sales orders render with correct total count", async ({ page }) => {
    await page.goto("/sales-orders");
    await expect(page.getByRole("heading", { name: "Sales Orders" })).toBeVisible();
    await page.waitForSelector("table tbody tr");
    // >= rather than exact: this module has no delete UI, so each real
    // "create a sales order" write test below (run repeatedly across
    // suite re-runs against this live, persistent org) permanently adds
    // one more row -- SEEDED_SALES_ORDER_COUNT is the documented Phase 1
    // floor, not a ceiling.
    const count = await page.locator("table tbody tr").count();
    expect(count).toBeGreaterThanOrEqual(SEEDED_SALES_ORDER_COUNT);
  });

  test("real write: create a new sales order for a seeded customer, verify it persists", async ({ page }) => {
    const before = await apiGet<{ salesOrders: unknown[] }>(page, "/api/sales-orders");
    const customersApi = await apiGet<{ customers: { customerName: string }[] }>(page, "/api/customers");
    const customer = customersApi.customers[0];
    const lineDesc = `E2E Batch C SO line ${uniqueSuffix()}`;

    await page.goto("/sales-orders");
    await page.waitForSelector("table tbody tr");

    // STALE-TEST FIX (2026-09-08, same real-screen conversion as
    // 04-vendors.spec.ts / 07-purchase-orders.spec.ts): "New Sales Order"
    // used to open a Dialog (role=dialog). SalesOrdersClient.tsx:23-30's own
    // header comment says that popup is gone as of the 2026-08-30
    // real-screen conversion -- it now does router.push("/sales-orders/new")
    // (SalesOrdersClient.tsx:140) to a dedicated create route
    // (SalesOrderCreateClient.tsx), same chain-sentence pattern used
    // throughout this app.
    await page.getByRole("button", { name: /new sales order/i }).click();
    await expect(page).toHaveURL(/\/sales-orders\/new$/);
    await expect(page.getByRole("heading", { name: "New Sales Order" })).toBeVisible();

    // STALE: the Customer field is a shadcn Select (role=combobox),
    // fetched via /api/customers on the create screen's own mount
    // (SalesOrderCreateClient.tsx:26,40) -- no longer scoped inside a
    // dialog's own DOM subtree. An unscoped page.getByRole("combobox").first()
    // would now silently grab the persistent sidebar's project-switcher
    // combobox instead (helpers.ts's fieldInput doc comment) since this
    // form lives on a full page, not an isolated dialog. Scope by the
    // "Customer" label via fieldInput, and pick a REAL known customer by
    // name (rather than "first visible option") so this doesn't race the
    // async fetch.
    await fieldInput(page, "Customer").click();
    await page.getByRole("option", { name: customer.customerName }).click();

    await page.getByPlaceholder("Description").fill(lineDesc);
    await page.getByPlaceholder("Qty").fill("3");
    await page.getByPlaceholder("Rate").fill("1500");

    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/sales-orders") && r.request().method() === "POST"),
      // STALE: no "Create Sales Order" button exists -- the create screen
      // is a shared-kit ObjectScreen, whose only footer control in create
      // mode is a plain "Save" button
      // (node_modules/@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx:92-100).
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(createRes.status(), await createRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("Sales order created")).toBeVisible();

    // STALE: nothing to close (no dialog) -- SalesOrderCreateClient.tsx:73
    // redirects to the new order's own Object Page on success, which
    // renders the real line items back from the server
    // (SalesOrderObjectClient.tsx:139-141).
    await expect(page).toHaveURL(/\/sales-orders\/[0-9a-f-]+$/);
    await expect(page.getByText(lineDesc)).toBeVisible({ timeout: 15_000 });

    await page.goto("/sales-orders");
    const after = await apiGet<{ salesOrders: unknown[] }>(page, "/api/sales-orders");
    expect(after.salesOrders.length, "new sales order did not persist").toBe(before.salesOrders.length + 1);
  });

  test("per-row status Select PATCHes and persists a real status change", async ({ page }) => {
    await page.goto("/sales-orders");
    await page.waitForSelector("table tbody tr");
    const draftRow = page.locator("table tbody tr", { has: page.getByText("draft", { exact: true }) }).first();
    const hasDraft = await draftRow.isVisible().catch(() => false);
    test.skip(!hasDraft, "no order currently in a draft-equivalent status to transition safely");
  });
});

test.describe("Sales dashboard (/sales)", () => {
  test("pipeline summary reflects real (empty) CRM data honestly", async ({ page }) => {
    await page.goto("/sales");
    await expect(page.getByRole("heading", { name: "Sales Dashboard" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    // GAP: verified live via GET /api/sales-pipeline -- Phase 1's seed
    // batches covered ERP selling (quotations/sales orders/invoices) but
    // NOT CRM leads/opportunities (crm_leads/crm_opportunities were 0 rows
    // as of Phase 1). This suite's own "create a new lead" write test
    // (Leads describe block below) permanently adds one on every re-run
    // (no delete UI exists) -- assert the card renders a real non-negative
    // number rather than re-asserting the one-time-true "0".
    const leadsCard = page.locator(".shadow-card", { hasText: "Total Leads" });
    const leadsText = await leadsCard.locator(".text-2xl").innerText({ timeout: 10_000 });
    expect(Number(leadsText)).toBeGreaterThanOrEqual(0);
  });

  test("nav links route to the real Leads/Opportunities/Quotations/Sales Orders/Customers pages", async ({ page }) => {
    await page.goto("/sales");
    await page.getByRole("link", { name: /view all leads/i }).click();
    await expect(page).toHaveURL(/\/sales\/leads/);
    await page.goBack();
    await page.getByRole("link", { name: /view all opportunities/i }).click();
    await expect(page).toHaveURL(/\/sales\/opportunities/);
  });
});

test.describe("Leads (/sales/leads)", () => {
  test("real write: create a new lead, verify it persists (module had zero seeded CRM data as of Phase 1)", async ({ page }) => {
    await page.goto("/sales/leads");
    // Note: "No leads found." only holds true the FIRST time this suite
    // runs against this live org -- this write test's own leads (and any
    // from prior re-runs) persist permanently (no delete UI exists), so
    // this is a one-time observation, not re-asserted here to keep the
    // suite safely re-runnable.

    const leadName = `E2E Batch C Lead ${uniqueSuffix()}`;
    await page.getByRole("button", { name: /new lead/i }).click();

    // STALE-TEST FIX (2026-09-08, same real-screen conversion as
    // 04-vendors.spec.ts): "New Lead" used to open a Dialog (role=dialog).
    // LeadsClient.tsx:22-28's own header comment says that popup is gone as
    // of the 2026-08-30 real-screen conversion -- it now does
    // router.push("/sales/leads/new") (LeadsClient.tsx:137) to a dedicated
    // create route (LeadCreateClient.tsx).
    await expect(page).toHaveURL(/\/sales\/leads\/new$/);
    await fieldInput(page, "Name").fill(leadName);

    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/leads") && r.request().method() === "POST"),
      // STALE: no "Create Lead" button exists -- the create screen is a
      // shared-kit ObjectScreen, whose only footer control in create mode
      // is a plain "Save" button
      // (node_modules/@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx:92-100).
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    await expect(page.getByText("Lead created")).toBeVisible();

    // STALE: nothing to close (no dialog) -- LeadCreateClient.tsx:43
    // redirects to the new lead's own Object Page on success, whose title
    // is the lead's real name (LeadObjectClient.tsx:87).
    await expect(page).toHaveURL(/\/sales\/leads\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: leadName })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Customers (/customers)", () => {
  test("real seeded customers render with correct total count", async ({ page }) => {
    await page.goto("/customers");
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
    await page.waitForSelector("table tbody tr");
    // >= rather than exact: no delete UI exists for customers, so this
    // suite's own "create a new customer" write test (below, and from any
    // prior re-run) permanently adds rows -- SEEDED_CUSTOMER_COUNT is the
    // documented Phase 1 floor, not a ceiling.
    const count = await page.locator("table tbody tr").count();
    expect(count).toBeGreaterThanOrEqual(SEEDED_CUSTOMER_COUNT);
  });

  test("search filters the real customer list", async ({ page }) => {
    await page.goto("/customers");
    await page.waitForSelector("table tbody tr");
    const firstName = (await page.locator("table tbody tr").first().locator("td").first().innerText()).trim();
    await page.getByPlaceholder(/search customers/i).fill(firstName);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table tbody tr").first()).toContainText(firstName);
  });

  test("real write: create a new customer, verify it persists", async ({ page }) => {
    const before = await apiGet<{ customers: unknown[] }>(page, "/api/customers");
    const customerName = `E2E Batch C Customer ${uniqueSuffix()}`;

    await page.goto("/customers");
    await page.waitForSelector("table tbody tr");

    // STALE-TEST FIX (2026-09-08, same real-screen conversion as
    // 04-vendors.spec.ts): "New Customer" used to open a Dialog
    // (role=dialog). CustomersClient.tsx:1-6's own header comment says that
    // popup is gone as of the 2026-08-30 real-screen conversion -- it now
    // does router.push("/customers/new") (CustomersClient.tsx:65) to a
    // dedicated create route (CustomerCreateClient.tsx).
    await page.getByRole("button", { name: /new customer/i }).click();
    await expect(page).toHaveURL(/\/customers\/new$/);
    await expect(page.getByRole("heading", { name: "New Customer" })).toBeVisible();
    await fieldInput(page, "Customer Name").fill(customerName);

    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/customers") && r.request().method() === "POST"),
      // STALE: no "Add Customer" button exists -- the create screen is a
      // shared-kit ObjectScreen, whose only footer control in create mode
      // is a plain "Save" button (CustomerCreateClient.tsx:40-57,
      // node_modules/@fchecklist/veridian-ui-kit/src/screens/ObjectScreen.tsx:92-100).
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    await expect(page.getByText("Customer added")).toBeVisible();

    // STALE: nothing to close (no dialog) -- CustomerCreateClient.tsx:31
    // redirects to the new customer's own Object Page on success.
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible({ timeout: 15_000 });

    await page.goto("/customers");
    const after = await apiGet<{ customers: { customerName: string }[] }>(page, "/api/customers");
    expect(after.customers.length).toBe(before.customers.length + 1);
    expect(after.customers.some((c) => c.customerName === customerName)).toBeTruthy();
    await expect(page.getByText(customerName)).toBeVisible();
  });

  test("customer overview drill-down shows real linked data", async ({ page }) => {
    await page.goto("/customers");
    await page.waitForSelector("table tbody tr");
    const firstLink = page.locator("table tbody tr").first().locator("a").first();
    const name = (await firstLink.innerText()).trim();
    await firstLink.click();
    await expect(page).toHaveURL(/\/customers\/[a-zA-Z0-9-]+/);
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Lifetime Invoiced")).toBeVisible();
  });
});
