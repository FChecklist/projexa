import { AppTopbar } from "@/components/AppTopbar";
import HrDashboardClient from "@/components/HrDashboardClient";

export default function HrDashboardPage() {
  return (
    <>
      <AppTopbar title="HR Dashboard" />
      <main className="flex-1 space-y-6 p-6">
        <HrDashboardClient />
      </main>
    </>
  );
}
