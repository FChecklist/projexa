import { AppTopbar } from "@/components/AppTopbar";
import OpportunitiesClient from "@/components/OpportunitiesClient";

export default function OpportunitiesPage() {
  return (
    <>
      <AppTopbar title="Opportunities" />
      <main className="flex-1 space-y-6 p-6">
        <OpportunitiesClient />
      </main>
    </>
  );
}
