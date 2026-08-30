import { PageHeading } from "@/components/PageHeading";
import InvoicesClient from "@/components/InvoicesClient";

// Real-screen conversion (2026-08-30): resolves ?tab= server-side and
// passes it down, same pattern as accounting/page.tsx, grc/page.tsx, and
// inventory/page.tsx.
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Invoices" />
        <InvoicesClient initialTab={tab} />
      </div>
    </>
  );
}
