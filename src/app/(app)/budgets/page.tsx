import { redirect } from "next/navigation";

// R67 D-62 (audit R-202). PROJEXA had ONE door called "Budgets" and it opened
// the ERP's fiscal-year budget: a screen that needs a fiscal year, a chart of
// accounts and a cost centre before it can save anything. That is a finance
// department's budget. The budget a project manager means -- Sumeet's own budget
// sheet, a percent and a vendor amount per BOQ line -- lives on /scope?tab=budget
// and had no nav entry at all.
//
// So the two are separated: the ERP budget moved to /finance/budgets, where its
// preconditions read as a finance-module fact rather than as PROJEXA being
// broken, and the Budgets nav entry now points at the project budget.
//
// This route is kept as a redirect rather than deleted. Every link, bookmark and
// screenshot in circulation says /budgets, and a 404 is a worse answer than the
// screen the user was asking for.
//
// R67 MERGE (D-11, lane D1 x lane D3, 2026-09-03): D3 landed D-43 on THIS file
// -- it dropped the bare <PageHeading title="Budgets" /> because BudgetsClient
// now renders the kit's own ScreenFrame header, and two headers stacked is the
// defect. That change is NOT lost by this file becoming a redirect: it has been
// applied to src/app/(app)/finance/budgets/page.tsx, which is where D-62 moved
// the real ERP budgets screen. The registry-column resolver D3 edited here moved
// with it and is unchanged.
//
// 2026-09-08 -- REAL BUG FOUND DURING A FULL LEFT/RIGHT WIRING SWEEP, FIXED.
// This was the one redirect in the /budgets family that dropped its query
// string outright -- its own siblings, /budgets/new and /budgets/[id], already
// carry ?projectId= across (see budgets/new/page.tsx's own comment: "the query
// string is carried across so ?projectId=... still arrives"). This one alone
// did not, so the module catalogue's own "Budget" entry (module-catalogue.ts's
// budgets.route = "/budgets") landed on /finance/budgets with NO project on
// the URL at all -- the composer's chain then had nothing to build a root
// segment from (M24Shell's routeProjectId came back null), so BOTH the module
// segment AND the project root vanished from the left panel, on a screen the
// right panel still tried to render. Fixed the same way the sibling redirect
// already does it: forward every query param verbatim.
export default async function BudgetsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) for (const v of value) query.append(key, v);
  }
  const suffix = query.toString();
  redirect(suffix ? `/finance/budgets?${suffix}` : "/finance/budgets");
}
