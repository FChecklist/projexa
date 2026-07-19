import { PageHeading } from "@/components/PageHeading";
import GrcClient from "@/components/GrcClient";

export default function GrcPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Risk & Compliance" />
        <GrcClient />
      </main>
    </>
  );
}
