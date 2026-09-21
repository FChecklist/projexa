import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { fetchKnowledgeBasePages } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import KnowledgeBaseClient, { type KbPage } from "@/components/KnowledgeBaseClient";

// PROJEXA-E2E-001 cold-load fix (2026-09-21) -- see
// module-list-source.ts's fetchKnowledgeBasePages for the full defect this
// closes. Org-wide -- deliberately no resolveSelectedProject()/projectId,
// unlike every other PROJEXA page. Distinct from the per-project Wiki
// (src/app/(app)/wiki/page.tsx).
const SKELETON = <ModuleListSkeletonBody columns={[]} actions={["New Page"]} />;

async function KnowledgeBaseSection() {
  const organizationId = await getServerOrganizationId();
  const { rows, errorMessage } = await fetchKnowledgeBasePages<KbPage>(organizationId);
  return <KnowledgeBaseClient initial={{ rows, errorMessage }} />;
}

export default function KnowledgeBasePage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Knowledge Base" />
      <Suspense fallback={SKELETON}>
        <KnowledgeBaseSection />
      </Suspense>
    </div>
  );
}
