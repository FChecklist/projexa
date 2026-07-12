import { AppTopbar } from "@/components/AppTopbar";
import SettingsClient from "@/components/SettingsClient";

export default function SettingsPage() {
  return (
    <>
      <AppTopbar title="Settings" />
      <main className="flex-1 space-y-6 p-6">
        <SettingsClient />
      </main>
    </>
  );
}
