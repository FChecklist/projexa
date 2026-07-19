import { PageHeading } from "@/components/PageHeading";
import VendorsClient from "@/components/VendorsClient";

export default function VendorsPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Vendors" />
        <VendorsClient />
      </main>
    </>
  );
}
