import { PageHeading } from "@/components/PageHeading";
import PermitsClient from "@/components/PermitsClient";

export default function PermitsPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Permits" />
        <PermitsClient />
      </main>
    </>
  );
}
