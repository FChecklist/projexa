import { AppTopbar } from "@/components/AppTopbar";
import RecruitmentClient from "@/components/RecruitmentClient";

export default function RecruitmentPage() {
  return (
    <>
      <AppTopbar title="Recruitment" />
      <main className="flex-1 space-y-6 p-6">
        <RecruitmentClient />
      </main>
    </>
  );
}
