import { AppTopbar } from "@/components/AppTopbar";
import LeadsClient from "@/components/LeadsClient";

export default function LeadsPage() {
  return (
    <>
      <AppTopbar title="Leads" />
      <main className="flex-1 space-y-6 p-6">
        <LeadsClient />
      </main>
    </>
  );
}
