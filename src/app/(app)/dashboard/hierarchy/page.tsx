import { PageHeading } from "@/components/PageHeading";
import { DashboardHierarchyClient } from "@/components/DashboardHierarchyClient";

// Company -> Department -> Project drill-down, per the Owner's diagram:
// pick a Company (a PROJEXA org you're a member of), then a Department,
// then a Project, then see its Revenue/Budget/Expense/Progress with a
// date-range filter and its BOQ category-distribution charts. See
// src/lib/company-scope.ts for why "Company" maps to a PROJEXA org
// membership rather than VERIDIAN's separate erp_companies concept.
export default function DashboardHierarchyPage() {
  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeading title="Company Dashboard" />
      <DashboardHierarchyClient />
    </main>
  );
}
