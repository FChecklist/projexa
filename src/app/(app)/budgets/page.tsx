import { AppTopbar } from "@/components/AppTopbar";
import BudgetsClient from "@/components/BudgetsClient";

export default function BudgetsPage() {
  return (
    <>
      <AppTopbar title="Budgets" />
      <main className="flex-1 space-y-6 p-6">
        <BudgetsClient />
      </main>
    </>
  );
}
