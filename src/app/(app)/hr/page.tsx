import { PageHeading } from "@/components/PageHeading";
import HrDashboardClient from "@/components/HrDashboardClient";

export default function HrDashboardPage() {
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="HR Dashboard" />
        <HrDashboardClient />
      </div>
    </>
  );
}
