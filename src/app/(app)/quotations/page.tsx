import { PageHeading } from "@/components/PageHeading";
import QuotationsClient from "@/components/QuotationsClient";

export default function QuotationsPage() {
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Quotations" />
        <QuotationsClient />
      </div>
    </>
  );
}
