import { PageHeading } from "@/components/PageHeading";
import PayrollClient from "@/components/PayrollClient";

export default function PayrollPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Payroll" />
        <PayrollClient />
      </main>
    </>
  );
}
