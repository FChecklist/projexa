import { PageHeading } from "@/components/PageHeading";
import OpportunitiesClient from "@/components/OpportunitiesClient";

export default function OpportunitiesPage() {
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Opportunities" />
        <OpportunitiesClient />
      </div>
    </>
  );
}
