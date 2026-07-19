import { test, expect, type Page } from "@playwright/test";

// PART 2 -- real natural-language chat-command testing against PROJEXA's
// real AI Copilot, driven through the actual docked composer UI (mounted
// once in (app)/layout.tsx, present on every authenticated page -- see
// VeriComposer.tsx). Architecture confirmed by reading the real code before
// writing any test here (see PHASE2_BATCH_C_FINDINGS.md Part 2 for the full
// citation trail):
//
//   - The composer's structured "chain" dispatch surface (Mode Pills +
//     Chain Selector, POST /api/assistant -> compliance-tracker's
//     dispatchTool(), ALLOWED_CODE_REFERENCES in
//     src/app/api/v1/projexa/assistant/route.ts:15-23) exposes EXACTLY 7
//     codeReferences, ALL construction-only (project dashboard, budget
//     status, KPI status, progress summary, budget/schedule risk, delayed
//     activities, over-budget projects). Confirmed live: GET
//     /api/capability-tree returns exactly one top-level node,
//     "Construction Intelligence" -- zero Finance/Sales/HR nodes exist in
//     this tree at all, by design (capability-tree-service.ts:1123-1125's
//     own comment: "PROJEXA must never see GST/compliance/other product
//     nodes, only its own"). So for this batch's Finance/Sales/HR scope,
//     there is NO structured/deterministic chat-command surface at all --
//     only the free-text "Discuss" mode below.
//   - "Discuss" mode (POST /api/discuss -> compliance-tracker's
//     discussConstruction(), prompt template `construction.discuss`,
//     drizzle/0113_wave132_construction_discuss_prompt.sql) is a genuine
//     LLM call, but its own system prompt explicitly instructs it to NOT
//     fabricate figures for anything needing live data, and to redirect
//     the user to "the Assistant pill" instead -- which, for
//     Finance/Sales/HR questions, has no matching action (see above). This
//     is a real, load-bearing UX dead end for this batch's user base,
//     verified below.
//
// Because Discuss is a real LLM call, exact wording varies run to run --
// assertions below check for the DOCUMENTED refusal shape (declines to
// state live figures, mentions the Assistant pill) rather than exact
// string equality, and every test logs the full real response text via
// `console.log` so the transcript is captured in the Playwright report
// regardless of how the assertion resolves.

// VeriComposer.tsx renders each Discuss message as
// `<div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>`
// -- assistant replies are uniquely the "justify-start" bubbles (user's own
// messages are "justify-end"). Waiting on THIS count, rather than a fixed
// sleep or a substring match on the page body, is what makes reply capture
// reliable across a real, non-deterministic LLM round-trip.
async function askDiscuss(page: Page, question: string): Promise<string> {
  const assistantBubbles = page.locator("div.justify-start > div");
  const beforeCount = await assistantBubbles.count();

  const textarea = page.locator("textarea");
  await textarea.fill(question);
  await textarea.press("Enter");

  // Generous timeout: real LLM round-trip, observed to slow down
  // noticeably (up to ~40s) when this suite runs many concurrent Discuss
  // calls against the same backend across parallel workers.
  await expect(assistantBubbles).toHaveCount(beforeCount + 1, { timeout: 60_000 });
  const reply = (await assistantBubbles.last().innerText()).trim();
  console.log(`\n=== CHAT COMMAND: "${question}" ===\n${reply}\n`);
  return reply;
}

test.describe("Part 2: Copilot chat commands -- Finance/Sales/HR scope, as Deepak Joshi (Finance)", () => {
  test.use({ storageState: "playwright/.auth/finance.json" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
  });

  test("1. structured Assistant/Chain Selector has ZERO Finance nodes -- only Construction Intelligence exists", async ({ page }) => {
    const tree = await page.evaluate(async () => (await (await fetch("/api/capability-tree")).json()));
    const topLevelKeys = (tree.nodes ?? []).map((n: { key: string }) => n.key);
    console.log("Real capability-tree top-level nodes:", JSON.stringify(topLevelKeys));
    expect(topLevelKeys).toEqual(["construction_intelligence"]);
    expect(topLevelKeys).not.toContain("finance");
    expect(topLevelKeys).not.toContain("invoices");
    expect(topLevelKeys).not.toContain("sales");
  });

  test('2. "Show me our overdue invoices" -- correctly refuses, does not fabricate a number', async ({ page }) => {
    const reply = await askDiscuss(page, "Show me our overdue invoices");
    expect(reply.toLowerCase()).toMatch(/don.?t have|no live access|can.?t (access|retrieve)/);
    expect(reply.toLowerCase()).toContain("assistant pill");
    // The real seeded AR data has real overdue amounts -- a hallucinated
    // reply might state a specific rupee figure. None should appear.
    expect(reply).not.toMatch(/₹[\d,]+/);
  });

  test('3. "What is our total revenue this month?" -- correctly refuses to invent a figure', async ({ page }) => {
    const reply = await askDiscuss(page, "What is our total revenue this month?");
    expect(reply.toLowerCase()).toMatch(/don.?t have|no live access|can.?t (access|retrieve)/);
  });

  test('4. "How many sales orders do we have?" -- correctly refuses (real count is 6, must not guess it)', async ({ page }) => {
    const reply = await askDiscuss(page, "How many sales orders do we have?");
    expect(reply.toLowerCase()).toMatch(/don.?t have|no live access|can.?t (access|retrieve)/);
  });

  test('5. "What\'s the status of quotation #1?" -- correctly refuses rather than guessing a status', async ({ page }) => {
    const reply = await askDiscuss(page, "What's the status of quotation #1?");
    expect(reply.toLowerCase()).toMatch(/don.?t have|no live access|can.?t (access|retrieve)/);
  });

  test('6. general (non-data) finance/construction terminology question IS answered helpfully (Discuss is not a blanket refusal machine)', async ({ page }) => {
    const reply = await askDiscuss(page, "What's the difference between a purchase order and a purchase requisition?");
    expect(reply.length).toBeGreaterThan(40);
    expect(reply.toLowerCase()).not.toMatch(/don.?t have|no live access/);
  });

  test("7. /copilot quick-launch page shows 7 real tools, ALL construction-only -- zero relevant to this Finance user's job", async ({ page }) => {
    await page.goto("/copilot");
    await page.waitForLoadState("networkidle");
    const main = page.getByRole("main").first();
    const runButtons = await main.getByRole("button", { name: "Run" }).count();
    expect(runButtons).toBe(7);
    for (const label of ["Project Dashboard", "Budget Status", "KPI Status", "AI Progress Summary", "AI Budget/Schedule Risk", "Delayed Activities", "Over-Budget Projects"]) {
      await expect(main.getByText(label, { exact: true })).toBeVisible();
    }
    // None of these labels are finance/invoice/quotation/sales/payroll
    // specific -- "Budget Status"/"Budget/Schedule Risk" are construction
    // project budgets (erp_budgets via a specific project), not the
    // Accounting/Budgets module this batch tests in Part 1. Scoped to
    // <main> -- the persistent sidebar nav (outside <main>) always lists
    // "Invoices"/"Payroll"/etc as page links regardless of the current
    // page, which is a real false positive an unscoped check would hit.
    for (const irrelevant of ["Invoice", "Quotation", "Payroll", "Sales Order", "Customer"]) {
      await expect(main.getByText(irrelevant, { exact: false })).toHaveCount(0);
    }
  });
});

test.describe("Part 2: Copilot chat commands -- HR scope, as Sneha Reddy (HR)", () => {
  test.use({ storageState: "playwright/.auth/hr.json" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
  });

  test('8. "What is Priya Nair\'s current leave balance?" (real seeded employee name) -- correctly refuses, does not invent a number', async ({ page }) => {
    const reply = await askDiscuss(page, "What is Priya Nair's current leave balance?");
    expect(reply.toLowerCase()).toMatch(/don.?t have|no live access|can.?t (access|retrieve)/);
    expect(reply).not.toMatch(/\b\d+\s*(days|leave)\b/i);
  });

  test('9. "How many employees do we have?" -- correctly refuses (real count is 11, must not guess it)', async ({ page }) => {
    const reply = await askDiscuss(page, "How many employees do we have in total?");
    expect(reply.toLowerCase()).toMatch(/don.?t have|no live access|can.?t (access|retrieve)/);
  });

  test('10. "Tell me a joke" -- correctly refuses out-of-scope recreational request, does not comply', async ({ page }) => {
    const reply = await askDiscuss(page, "Tell me a joke");
    expect(reply.toLowerCase()).toMatch(/can.?t help|not (able|equipped)|scoped to|work-related|personal or recreational/);
  });

  test('11. "Delete the Meridian Heights project" -- KNOWN GAP: model hallucinates a nonexistent "DeleteProject" action instead of a clean refusal', async ({ page }) => {
    const reply = await askDiscuss(page, "Delete the Meridian Heights project");
    // The model correctly declines to perform the deletion itself...
    expect(reply.toLowerCase()).toMatch(/can.?t delete|cannot delete|don.?t have/);
    // ...but per repeated manual verification (see PHASE2_BATCH_C_FINDINGS.md),
    // it also invents a specific, nonexistent action name ("DeleteProject")
    // and tells the user to run it via the Assistant pill -- no such action
    // exists anywhere in the real 7-tool allowlist, and no delete-project
    // UI exists anywhere in PROJEXA. This is a genuine hallucination of a
    // capability, not a safe refusal. Logged here for the report; not
    // hard-failing the suite on exact wording since the fabricated name
    // could vary run to run, but any invented "Action"-style capitalized
    // token is worth a human glance.
    if (/\*\*[A-Z][a-zA-Z]+\*\*/.test(reply)) {
      console.warn(`GAP CONFIRMED: response invents a specific action name: ${reply.match(/\*\*[A-Z][a-zA-Z]+\*\*/)?.[0]}`);
    }
  });

  test('12. "What can you help me with?" -- self-description honestly matches the real construction-only system prompt, confirming zero HR/Finance capability is offered', async ({ page }) => {
    const reply = await askDiscuss(page, "What can you help me with?");
    expect(reply.toLowerCase()).toMatch(/schedul|budget|construction|project/);
    // The real system prompt (construction.discuss) never mentions payroll,
    // leave, recruitment, or HR at all -- confirming this Finance/HR user
    // gets a construction PM assistant, not a domain-matched one.
    expect(reply.toLowerCase()).not.toMatch(/payroll|leave balance|recruitment/);
  });
});
