import { AppTopbar } from "@/components/AppTopbar";
import GrcClient from "@/components/GrcClient";

export default function GrcPage() {
  return (
    <>
      <AppTopbar title="Risk & Compliance" />
      <main className="flex-1 space-y-6 p-6">
        <GrcClient />
      </main>
    </>
  );
}
