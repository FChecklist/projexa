import { PageHeading } from "@/components/PageHeading";
import KnowledgeBaseClient from "@/components/KnowledgeBaseClient";

// Org-wide -- deliberately no resolveSelectedProject()/projectId, unlike
// every other PROJEXA page. Distinct from the per-project Wiki
// (src/app/(app)/wiki/page.tsx).
export default function KnowledgeBasePage() {
  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Knowledge Base" />
        <KnowledgeBaseClient />
      </div>
    </>
  );
}
