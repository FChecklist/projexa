import { PageHeading } from "@/components/PageHeading";
import EmployeesClient from "@/components/EmployeesClient";

// Real-screen conversion (2026-08-30): resolves ?tab= server-side and passes
// it down, so the new Department/Leave-Request/Leave-Balance create screens'
// redirects (e.g. /employees?tab=leave) land on the right tab instead of
// always defaulting to "directory" -- same pattern as accounting/page.tsx's
// own initialTab resolution.
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Employees" />
        <EmployeesClient initialTab={tab} />
      </div>
    </>
  );
}
