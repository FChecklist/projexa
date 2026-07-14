import { AppTopbar } from "@/components/AppTopbar";
import EmployeesClient from "@/components/EmployeesClient";

export default function EmployeesPage() {
  return (
    <>
      <AppTopbar title="Employees" />
      <main className="flex-1 space-y-6 p-6">
        <EmployeesClient />
      </main>
    </>
  );
}
