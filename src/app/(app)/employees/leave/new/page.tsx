import LeaveRequestCreateClient from "@/components/LeaveRequestCreateClient";

// Real-screen conversion (2026-08-30): replaces the old "Request Leave"
// Dialog popup with a real create route.
export default function LeaveRequestNewPage() {
  return (
    <div className="flex-1">
      <LeaveRequestCreateClient />
    </div>
  );
}
