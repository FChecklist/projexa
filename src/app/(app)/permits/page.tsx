import { AppTopbar } from "@/components/AppTopbar";
import PermitsClient from "@/components/PermitsClient";

export default function PermitsPage() {
  return (
    <>
      <AppTopbar title="Permits" />
      <main className="flex-1 space-y-6 p-6">
        <PermitsClient />
      </main>
    </>
  );
}
