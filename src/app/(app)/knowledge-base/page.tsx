import { AppTopbar } from "@/components/AppTopbar";
import KnowledgeBaseClient from "@/components/KnowledgeBaseClient";

// Org-wide -- deliberately no resolveSelectedProject()/projectId, unlike
// every other PROJEXA page. Distinct from the per-project Wiki
// (src/app/(app)/wiki/page.tsx).
export default function KnowledgeBasePage() {
  return (
    <>
      <AppTopbar title="Knowledge Base" />
      <main className="flex-1 space-y-6 p-6">
        <KnowledgeBaseClient />
      </main>
    </>
  );
}
