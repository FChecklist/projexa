import { PageHeading } from "@/components/PageHeading";
import BudgetsClient from "@/components/BudgetsClient";

export default function BudgetsPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Budgets" />
        <BudgetsClient />
      </main>
    </>
  );
}
