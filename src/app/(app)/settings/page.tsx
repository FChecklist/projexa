import { PageHeading } from "@/components/PageHeading";
import SettingsClient from "@/components/SettingsClient";

export default function SettingsPage() {
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Settings" />
        <SettingsClient />
      </div>
    </>
  );
}
