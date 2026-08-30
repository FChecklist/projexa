import { PageHeading } from "@/components/PageHeading";
import RecruitmentClient from "@/components/RecruitmentClient";

// Real-screen conversion (2026-08-30): resolves ?tab= server-side and
// passes it down, same pattern as accounting/page.tsx, grc/page.tsx, etc.
export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Recruitment" />
        <RecruitmentClient initialTab={tab} />
      </div>
    </>
  );
}
