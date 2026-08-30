import { PageHeading } from "@/components/PageHeading";
import AccountingClient from "@/components/AccountingClient";

// Real-screen conversion (2026-08-30): resolves ?tab= server-side and passes
// it down, so the new Journal-Entry/Company create screens' redirects (e.g.
// /accounting?tab=ledger) land on the right tab instead of always
// defaulting to "dashboard" -- same pattern as schedule/page.tsx's own
// initialTab resolution.
export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Accounting" />
        <AccountingClient initialTab={tab} />
      </div>
    </>
  );
}
