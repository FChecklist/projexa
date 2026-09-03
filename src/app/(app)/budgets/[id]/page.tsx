import { redirect } from "next/navigation";

// R67 D-62: the ERP budget object page moved to /finance/budgets/[id]. Old links
// to a specific budget keep working.
export default async function BudgetDetailRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/finance/budgets/${encodeURIComponent(id)}`);
}
