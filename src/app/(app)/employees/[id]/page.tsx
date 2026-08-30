import EmployeeObjectClient from "@/components/EmployeeObjectClient";

// Real-screen conversion (2026-08-30): the Employees module's first Object
// Page -- previously "View" opened a read-only Dialog with a separate Edit
// dialog reachable from its footer. Thin pass-through, same pattern as
// permits/[id]/page.tsx.
export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <EmployeeObjectClient employeeId={id} />
    </div>
  );
}
