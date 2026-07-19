import { PageHeading } from "@/components/PageHeading";
import RecruitmentClient from "@/components/RecruitmentClient";

export default function RecruitmentPage() {
  return (
    <>
      <main className="flex-1 space-y-6 p-6">
        <PageHeading title="Recruitment" />
        <RecruitmentClient />
      </main>
    </>
  );
}
