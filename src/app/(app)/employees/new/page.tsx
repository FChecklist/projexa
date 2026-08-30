import EmployeeCreateClient from "@/components/EmployeeCreateClient";

// Real-screen conversion (2026-08-30): replaces the old combined "Create /
// Update Employee Profile" Dialog's create half with a real create route.
export default function EmployeeNewPage() {
  return (
    <div className="flex-1">
      <EmployeeCreateClient />
    </div>
  );
}
