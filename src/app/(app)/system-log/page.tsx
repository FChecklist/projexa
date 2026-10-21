import { PageHeading } from "@/components/PageHeading";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { ROLE_GROUPS } from "@/lib/authz/roles";
import SystemLogClient from "@/components/SystemLogClient";
import { AccessDenied } from "@/components/NotFoundGuide";

// OWNER SCREEN. Everything that went wrong while people used PROJEXA, and what was done about it.
// The data is captured on each person's own phone or laptop (src/lib/client-log) and stored as plain rows; the list below is read through
// /api/client-logs/*, which only owners and admins may call. The same rule is applied here so anyone else sees a plain sentence, not a broken table.
export default async function SystemLogPage() {
  const ctx = await requireAuth();
  const allowed = !!ctx.role && (ROLE_GROUPS.ORG_ADMIN as readonly string[]).includes(ctx.role);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="System log" note="Everything that went wrong while people used PROJEXA, and what was done about it." />
      {allowed ? (
        <SystemLogClient />
      ) : (
        <div data-testid="system-log-not-allowed">
          <AccessDenied code="SYSTEM_LOG_OWNER_ONLY" testId="system-log-denied-panel" />
        </div>
      )}
    </div>
  );
}
