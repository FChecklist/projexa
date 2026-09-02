import BudgetCreateClient from "@/components/BudgetCreateClient";

// Real-screen conversion (2026-08-30): replaces the old "New Budget" Dialog
// popup with a real create route.
export default function BudgetNewPage() {
  return (
    <div className="flex-1">
      <BudgetCreateClient />
    </div>
  );
}
