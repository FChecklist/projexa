import LeaveBalanceCreateClient from "@/components/LeaveBalanceCreateClient";

// Real-screen conversion (2026-08-30): replaces the old "Set Leave Balance"
// Dialog popup with a real create route.
export default function LeaveBalanceNewPage() {
  return (
    <div className="flex-1">
      <LeaveBalanceCreateClient />
    </div>
  );
}
