import { PageHeading } from "@/components/PageHeading";
import LeadsClient from "@/components/LeadsClient";

export default function LeadsPage() {
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Leads" />
        <LeadsClient />
      </div>
    </>
  );
}
