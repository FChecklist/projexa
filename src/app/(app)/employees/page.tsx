import { PageHeading } from "@/components/PageHeading";
import EmployeesClient from "@/components/EmployeesClient";

export default function EmployeesPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Employees" />
        <EmployeesClient />
      </main>
    </>
  );
}
