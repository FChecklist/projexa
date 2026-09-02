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
export default function BudgetsRedirectPage() {
  redirect("/finance/budgets");
}
