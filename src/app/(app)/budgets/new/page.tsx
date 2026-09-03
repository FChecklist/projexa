import { redirect } from "next/navigation";

// R67 D-62: the ERP budget create screen moved to /finance/budgets/new. The
// query string is carried across so ?projectId= (which DASHBOARD.PROJECT's
// "Budget vs Actual" tile used to send here) still arrives.
export default async function BudgetNewRedirectPage({
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
  redirect(suffix ? `/finance/budgets/new?${suffix}` : "/finance/budgets/new");
}
