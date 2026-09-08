import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// R81 D6-03. R-80 / R-81 / R-82 -- the module-chain + assistant trio that was
// BLOCKED only because its recorded route pointed at the paused
// https://projexa-ai.com. Re-tested against http://localhost:3100, whose
// VERIDIAN_API_BASE_URL points at the live local compliance-tracker
// (http://localhost:3000/api/v1/projexa), so Environment 1 is complete.
//
// READ-ONLY BY CONSTRUCTION. POST /api/assistant inserts an assistant_queries
// row (route.ts inserts "pending" before dispatching), and this work order
// forbids any database write -- so no test here dispatches. R-80's "full pill
// path" is therefore proved on the path that is genuinely read-only: a visible
// pill -> its real destination -> real content rendered there. R-82 is proved
// from the assistant's own read surfaces.
test.use({ storageState: "playwright/.auth/ceo.json", viewport: { width: 1440, height: 900 } });

const P = DEFAULT_PROJECT.id;

async function openAllModules(page: import("@playwright/test").Page) {
  const group = page.getByRole("group", { name: "All modules" });
  if ((await group.count()) === 0) {
    const toggle = page.getByRole("button", { name: /^All modules$/i }).first();
    if ((await toggle.count()) > 0) {
      await toggle.click();
      await page.waitForTimeout(800);
    }
  }
  return page.getByRole("group", { name: "All modules" });
}

// ---------------------------------------------------------------------------
// R-81  NO visible pill may be unwired -- hide the other 402
// TRUE when: (a) the large /api/module-chain population contributes ZERO
// visible pills/modes, and (b) every pill that IS visible is enabled and
// reaches a real destination when clicked.
// ---------------------------------------------------------------------------
test("R-81 every visible pill is wired, and the module-chain population is hidden", async ({ page }) => {
  // This test CLICKS every pill in the strip -- 22 of them at the time of
  // writing -- with a settle wait after each and a navigation reset whenever
  // one navigates. That is inherently minutes, not seconds, and the config's
  // 75s default is sized for a normal test. Raised here rather than globally
  // so nothing else silently gains headroom it should not need.
  //
  // It only started exceeding the budget once the module-chain leak assertion
  // moved BELOW the sweep: previously that assertion failed first and the
  // sweep never ran to completion, so the cost was never paid. The slowness is
  // pre-existing; what changed is that the test now reaches it.
  test.setTimeout(300_000);
  // (0) How big is the population that must stay hidden?
  const mc = await page.request.get("/api/module-chain");
  const mcStatus = mc.status();
  let mcTopLevel: string[] = [];
  let mcLeafCount = 0;
  if (mc.ok()) {
    const body = (await mc.json()) as { nodes?: Array<{ key: string; label?: string; leaf?: boolean; children?: unknown[] }> };
    const nodes = body.nodes ?? [];
    mcTopLevel = nodes.map((n) => n.label ?? n.key);
    const countLeaves = (ns: Array<{ leaf?: boolean; children?: unknown[] }>): number =>
      ns.reduce((acc, n) => acc + (n.leaf ? 1 : countLeaves((n.children ?? []) as Array<{ leaf?: boolean; children?: unknown[] }>)), 0);
    mcLeafCount = countLeaves(nodes as Array<{ leaf?: boolean; children?: unknown[] }>);
  }
  console.log(`R81_D603_R81_MODULECHAIN status=${mcStatus} topLevel=${JSON.stringify(mcTopLevel)} leafCount=${mcLeafCount}`);

  await page.goto(`/dashboard?projectId=${P}`);
  await page.waitForLoadState("domcontentloaded");
  const modules = await openAllModules(page);
  await expect(modules).toBeVisible({ timeout: 45_000 });

  const pills = modules.getByRole("button");
  const total = await pills.count();
  const labels: string[] = [];
  const disabled: string[] = [];
  for (let i = 0; i < total; i++) {
    const b = pills.nth(i);
    const name = ((await b.getAttribute("aria-label")) ?? (await b.textContent()) ?? "").trim();
    labels.push(name);
    if (await b.isDisabled()) disabled.push(name);
  }
  console.log(`R81_D603_R81_PILLS visible=${total} labels=${JSON.stringify(labels)}`);
  console.log(`R81_D603_R81_DISABLED ${JSON.stringify(disabled)}`);

  expect(total, "the All modules strip rendered no pills at all").toBeGreaterThan(0);
  expect(disabled, "a visible pill that cannot be pressed is an unwired pill").toEqual([]);

  // (a) None of the module-chain top-level chains may be offered.
  //
  // R81 K5-04 CORRECTION. This was a SUBSTRING match over a joined blob:
  //   labels.join(" | ").toLowerCase().includes(node.toLowerCase())
  // PROJEXA ships its own pills named "Customers (Alt+U)", "Vendors (Alt+V)"
  // and "Reports (Alt+R)"; /api/module-chain ships top-level nodes named
  // "Customer", "Vendor" and "Reports". Every one of those is a substring of a
  // legitimate pill, so the check reported three leaks on a screen that had
  // none, and would have failed R-81 for a name collision. Compare whole
  // labels instead: strip the trailing "(Alt+X)" accelerator and require an
  // exact, case-insensitive match against a chain name.
  const norm = (s: string) => s.replace(/\s*\(Alt\+[^)]*\)\s*$/i, "").trim().toLowerCase();
  const pillNames = new Set(labels.map(norm));
  const sharedNames = mcTopLevel.filter((n) => n && pillNames.has(norm(n)));
  console.log(`R81_D603_R81_SHARED ${JSON.stringify(sharedNames)} (exact-match; pills=${JSON.stringify([...pillNames])})`);
  // The leak assertion itself now lives BELOW, after the click sweep -- see
  // the note there for why appearing in both places is not the defect.

  // No pill may advertise itself as a dead end.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "a pill is rendering the 'Not part of PROJEXA' dead-end line").not.toContain("Not part of PROJEXA");

  // (b) Every visible pill must DO something. Click each; assert an
  // observable effect (URL change, or the chain strip gained this pill).
  const results: Array<{ label: string; effect: string }> = [];
  for (let i = 0; i < total; i++) {
    const before = page.url();
    const beforeStrip = (await page.locator("body").innerText()).slice(0, 4000);
    const strip = await openAllModules(page);
    let btn = strip.getByRole("button").nth(i);
    // count() BEFORE getAttribute(), not after. getAttribute on a locator that
    // matches nothing does not return null -- it WAITS the full 15s timeout and
    // then throws, so a strip that came back shorter after a navigation reset
    // failed the whole test with a TimeoutError instead of recording anything.
    // The absent-pill branch existed for exactly that case and could never be
    // reached, because the line meant to detect it ran second. That is why this
    // sweep had never once run to completion.
    //
    // A shorter strip gets ONE retry rather than an immediate verdict: the loop
    // navigates away and back on every pill that navigates, so a strip caught
    // mid-render is expected and is not the product failing. If it is still
    // short after a reopen, that IS worth reporting, and it reports as SHORT --
    // "the strip rendered fewer pills than it did at the start" -- not as
    // "this pill is dead", which would assert a defect the run did not observe.
    if ((await btn.count()) === 0) {
      const reopened = await openAllModules(page);
      btn = reopened.getByRole("button").nth(i);
      if ((await btn.count()) === 0) {
        results.push({ label: `pill#${i}`, effect: "SHORT" });
        continue;
      }
    }
    const label = ((await btn.getAttribute("aria-label")) ?? "").trim();
    const focusBefore = await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120) ?? "");
    await btn.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(900);
    const after = page.url();
    const afterStrip = (await page.locator("body").innerText()).slice(0, 4000);
    // FOCUS COUNTS AS AN OBSERVABLE EFFECT, and leaving it out was a blind spot
    // rather than a strictness. "Other -- type it" exists to say "the box is
    // where this happens" (M24Shell A-15): its whole job is to put the cursor in
    // the composer input. That changes no URL and no body text, so the sweep
    // recorded it as a dead pill -- a pill doing precisely what it was designed
    // to do, reported as a defect.
    const focusAfter = await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120) ?? "");
    const effect =
      after !== before
        ? `nav:${after.replace("http://localhost:3100", "")}`
        : afterStrip !== beforeStrip
          ? "state-change"
          : focusAfter !== focusBefore
            ? "focus-change"
            : "NONE";
    results.push({ label, effect });
    if (after !== before) {
      await page.goto(`/dashboard?projectId=${P}`);
      await page.waitForLoadState("domcontentloaded");
    }
  }
  console.log(`R81_D603_R81_CLICKS ${JSON.stringify(results, null, 1)}`);

  // SHORT is deliberately NOT in `dead`: it says the strip re-rendered short,
  // which is a statement about the run, not about a pill. Asserted separately
  // below so it cannot silently hide half the sweep either.
  const short = results.filter((r) => r.effect === "SHORT");
  expect(
    short.length,
    `the module strip re-rendered short on ${short.length} of ${total} iterations, so those pills were never exercised`,
  ).toBeLessThan(Math.ceil(total / 4));
  const dead = results.filter((r) => r.effect === "NONE");
  expect(dead, `these visible pills produced no observable effect when clicked: ${JSON.stringify(dead)}`).toEqual([]);

  // (a), moved down here because it needs (b)'s answer.
  //
  // R81 2026-09-09 CORRECTION, the second one this assertion has needed. It
  // used to read: nothing appearing in /api/module-chain may appear as a
  // visible pill. That is a PROXY for R-81, and it is wrong for any module
  // that legitimately lives in both places. `reports` is one: it has a
  // registered executor (`run_work_progress_report`, module `reports`, in
  // ct/src/lib/pipeline/function-registry.ts), so the Reports pill is BACKED
  // -- exactly not the unwired dead end R-81 exists to prevent. The proxy held
  // for the 402 unwired chains and failed on the one backed name.
  //
  // R-81 says a pill must not be a dead end. So the test now says that, using
  // the click sweep above as the discriminator rather than a name table: a
  // chain name that also appears as a pill is only a defect if that pill DID
  // NOTHING. Sharing a name is not the fault; sharing a name while doing
  // nothing is.
  //
  // Deliberately NOT keyed on the executor registry: that lives in the other
  // repo and this spec cannot import across the boundary, and a hardcoded copy
  // of "which modules are backed" would rot the day one is wired. Behaviour is
  // the honest discriminator and it is already measured three lines up.
  const deadNames = new Set(results.filter((r) => r.effect === "NONE").map((r) => norm(r.label)));
  const leaked = sharedNames.filter((n) => deadNames.has(norm(n)));
  console.log(`R81_D603_R81_LEAKED ${JSON.stringify(leaked)} (shared AND dead)`);
  expect(
    leaked,
    "a /api/module-chain chain is offered as a visible pill that does nothing when clicked",
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// R-80  ONE full pill path works end to end
// TRUE when: a pill can be clicked, it reaches its real destination, and that
// destination renders REAL content -- not a shell, not an error.
// ---------------------------------------------------------------------------
test("R-80 one full pill path works end to end", async ({ page }) => {
  await page.goto(`/dashboard?projectId=${P}`);
  await page.waitForLoadState("domcontentloaded");
  const modules = await openAllModules(page);
  await expect(modules).toBeVisible({ timeout: 45_000 });

  // Take the first pill whose click actually navigates, and follow it all the
  // way to rendered content.
  const total = await modules.getByRole("button").count();
  let chosenLabel = "";
  let chosenUrl = "";
  for (let i = 0; i < total; i++) {
    const strip = await openAllModules(page);
    const btn = strip.getByRole("button").nth(i);
    const label = ((await btn.getAttribute("aria-label")) ?? "").trim();
    const before = page.url();
    await btn.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    if (page.url() !== before) {
      chosenLabel = label;
      chosenUrl = page.url();
      break;
    }
    // The "Things you can do" group is PillStrip's Frequent-actions band, and
    // it is NOT this pill's verbs. PillStrip.tsx:291 renders `screenCards`,
    // which M24Shell.tsx:3510 supplies as `selectedModule ? [] : screenCardViews`
    // -- the CURRENT SCREEN's own leaves, keyed by route and tab, and empty
    // once a module is selected.
    //
    // Recorded because I got this wrong and filed a fault on it. Reading the
    // band after clicking Permits showed ["Add drawing", "Upload document",
    // "Run report", ...] and I reported it as "the Permits pill offers no
    // permit verb". It offers none because this band was never its verbs; it
    // was the dashboard's, correctly labelled "Frequent actions" on screen.
    // The product was right and the reading was wrong.
    //
    // What this branch therefore tests is still real and still worth having --
    // a pill click followed by a frequent action reaches a destination that
    // renders -- so it is kept, and only the name it reports is corrected. A
    // test that follows a MODULE's own leaves is a different test and does not
    // exist yet.
    const frequentActions = page.getByRole("group", { name: "Things you can do" }).getByRole("button");
    if ((await frequentActions.count()) > 0) {
      await frequentActions.first().click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if (page.url() !== before) {
        chosenLabel = `${label} -> frequent action`;
        chosenUrl = page.url();
        break;
      }
    }
    await page.goto(`/dashboard?projectId=${P}`);
    await page.waitForLoadState("domcontentloaded");
  }

  console.log(`R81_D603_R80_PATH pill="${chosenLabel}" destination=${chosenUrl}`);
  expect(chosenLabel, "no pill in the strip reached a destination").not.toBe("");

  // The destination must render REAL content, asserted on content not shell.
  await page.waitForLoadState("domcontentloaded");
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  console.log(`R81_D603_R80_DEST_TEXT ${JSON.stringify(text.slice(0, 500))}`);
  expect(text.length, "the destination screen rendered no text").toBeGreaterThan(200);
  expect(text, "the destination screen is an error page").not.toMatch(/Application error|Unhandled Runtime Error|500 - Internal/i);

  // And it must carry a real INTERACTIVE surface, not just a heading.
  //
  // 2026-09-09: this used to demand a table row, [role=row] or a card, which
  // assumes every destination is a LIST. It is not. The verb model (D-08) is
  // "the pill narrows the sentence, the VERB navigates", and a create verb
  // legitimately lands on a blank form -- /drawings/new has no rows and never
  // will, so the assertion failed a path that worked. Widened to accept a form
  // as a real destination, which is what R-80 means by "renders REAL content,
  // not a shell".
  const dataSurfaces = await page.locator("table tbody tr, [role=row], [data-slot=card]").count();
  // NOT scoped to "form ...": /drawings/new renders 6 inputs, a textarea, a
  // select and a combobox and contains ZERO <form> elements -- the create
  // screens submit through handlers, not form submission. Scoping to a <form>
  // ancestor found nothing and reported a working screen as a shell.
  const formSurfaces = await page.locator("input, textarea, select, [role=combobox]").count();
  console.log(`R81_D603_R80_DEST_ROWS ${dataSurfaces} formFields=${formSurfaces}`);
  expect(
    dataSurfaces + formSurfaces,
    "the destination rendered neither a data surface nor a form -- it is a shell",
  ).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// R-82  Assistant either reaches project data or is hidden
// TRUE when: EITHER no assistant surface is offered, OR the surface that is
// offered demonstrably reaches this org's real project data.
// Read-only: dispatching would INSERT an assistant_queries row.
// ---------------------------------------------------------------------------
test("R-82 the assistant reaches real project data (or is not offered at all)", async ({ page }) => {
  // What the assistant's own data plane returns for this org, live.
  const tree = await page.request.get("/api/capability-tree");
  const treeStatus = tree.status();
  let treeTop: string[] = [];
  let treeLeaves = 0;
  if (tree.ok()) {
    const body = (await tree.json()) as { nodes?: Array<{ key: string; label?: string; leaf?: boolean; children?: unknown[] }> };
    const nodes = body.nodes ?? [];
    treeTop = nodes.map((n) => n.label ?? n.key);
    const countLeaves = (ns: Array<{ leaf?: boolean; children?: unknown[] }>): number =>
      ns.reduce((a, n) => a + (n.leaf ? 1 : countLeaves((n.children ?? []) as Array<{ leaf?: boolean; children?: unknown[] }>)), 0);
    treeLeaves = countLeaves(nodes as Array<{ leaf?: boolean; children?: unknown[] }>);
  }
  console.log(`R81_D603_R82_TREE status=${treeStatus} top=${JSON.stringify(treeTop)} leaves=${treeLeaves}`);

  // The assistant's own history: rows here are answers it already produced
  // against this org's data.
  const hist = await page.request.get("/api/assistant");
  const histStatus = hist.status();
  const histBody = (await hist.text()).slice(0, 600);
  console.log(`R81_D603_R82_HISTORY status=${histStatus} body=${JSON.stringify(histBody)}`);

  // Is an assistant surface actually offered to the user?
  await page.goto(`/copilot?projectId=${P}`);
  await page.waitForLoadState("domcontentloaded");
  const runButtons = await page.getByRole("button", { name: "Run" }).count();
  const copilotText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  console.log(`R81_D603_R82_COPILOT runButtons=${runButtons} text=${JSON.stringify(copilotText.slice(0, 400))}`);

  const offered = runButtons > 0;
  if (!offered) {
    // "or is hidden" -- the other honest half of the requirement.
    console.log("R81_D603_R82 assistant surface NOT offered => satisfied by the 'hidden' branch");
    return;
  }

  // It IS offered, so it must reach project data.
  expect(treeStatus, "the assistant is offered but its capability tree does not answer").toBe(200);
  expect(treeLeaves, "the assistant is offered but its capability tree contains no runnable leaf").toBeGreaterThan(0);
  expect(histStatus, "the assistant is offered but its own history endpoint does not answer").toBe(200);

  // And the surface must name real, org-scoped things rather than a shell.
  expect(copilotText.length, "the copilot screen rendered no content").toBeGreaterThan(200);
});
