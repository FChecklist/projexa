import DepartmentCreateClient from "@/components/DepartmentCreateClient";

// Real-screen conversion (2026-08-30): replaces the old "New Department"
// Dialog popup with a real create route.
export default function DepartmentNewPage() {
  return (
    <div className="flex-1">
      <DepartmentCreateClient />
    </div>
  );
}
