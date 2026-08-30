import CompanyCreateClient from "@/components/CompanyCreateClient";

// Real-screen conversion (2026-08-30): replaces the old "New Company /
// Office" Dialog popup with a real create route.
export default function CompanyNewPage() {
  return (
    <div className="flex-1">
      <CompanyCreateClient />
    </div>
  );
}
