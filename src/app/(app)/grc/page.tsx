import { PageHeading } from "@/components/PageHeading";
import GrcClient from "@/components/GrcClient";

// Real-screen conversion (2026-08-30): resolves ?tab= server-side and
// passes it down, same pattern as accounting/page.tsx and employees/page.tsx.
export default async function GrcPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Risk & Compliance" />
        <GrcClient initialTab={tab} />
      </div>
    </>
  );
}
