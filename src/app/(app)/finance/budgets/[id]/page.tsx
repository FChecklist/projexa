import BudgetObjectClient from "@/components/BudgetObjectClient";

// Real-screen conversion (2026-08-30): the Budgets module's first Object
// Page — previously there was no detail/edit/submit/cancel screen for a
// single budget at all. Thin pass-through, same pattern as permits/[id]/page.tsx.
export default async function BudgetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <BudgetObjectClient budgetId={id} />
    </div>
  );
}
