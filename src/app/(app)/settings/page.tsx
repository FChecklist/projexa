import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { PageHeading } from "@/components/PageHeading";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getSettingsOrgInfo, getSettingsMembers } from "@/lib/settings-source";
import SettingsClient from "@/components/SettingsClient";

// PROJEXA-E2E-001 cold-load investigation (2026-09-21). Before this, the
// page shell rendered instantly but SettingsClient started `loading=true`
// and blocked its ENTIRE content (Organization/Your Account/Team cards)
// behind one spinner until TWO client-side fetches -- GET /api/organization
// and GET /api/org-members -- resolved after hydration, with zero
// server-side prefetch. Same class of gap R67 F-18 already closed on
// documents/labour/budgets/reports/MoMs: the frame streams first, but the
// data-dependent subtree is now fetched HERE, server-side, inside a
// <Suspense> boundary, and handed down as `initial` props.
//
// The organization/currency fetch (independent, has its own loading state)
// and the five sub-cards (WorkspaceConnectionCard/OrgInvitesCard/
// GoogleSheetsCard/BoqCategoriesCard/DailyDigestCard, each with its own
// isolated client-side fetch and its own loading affordance) are
// DELIBERATELY left untouched here -- they don't gate the page's single
// blocking `loading` spinner the way organization+members did, so fixing
// them is separate, smaller, follow-on work, not silently rolled into this
// change.
export default async function SettingsPage() {
  const ctx = await requireAuth();

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Settings" />
      <Suspense fallback={<div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>}>
        {ctx.organizationId ? (
          <SettingsSection organizationId={ctx.organizationId} role={ctx.role} user={ctx.user} />
        ) : (
          <SettingsClient />
        )}
      </Suspense>
    </div>
  );
}

async function SettingsSection({
  organizationId,
  role,
  user,
}: {
  organizationId: string;
  role: string | null;
  user: { id: string; email: string | null } | null;
}) {
  const [orgInfo, membersResult] = await Promise.all([
    getSettingsOrgInfo({ organizationId, role, user }),
    getSettingsMembers(organizationId),
  ]);

  // Either read failing is not fatal -- SettingsClient already knows how to
  // show its own error/empty state; falling back to a client-side fetch
  // here (initial=undefined) means a transient SSR-side hiccup degrades to
  // the OLD behavior rather than a broken page.
  const initialOrgInfo = "error" in orgInfo ? undefined : orgInfo;
  const initialMembers = "error" in membersResult ? undefined : membersResult.members;

  return <SettingsClient initialOrgInfo={initialOrgInfo} initialMembers={initialMembers} />;
}
