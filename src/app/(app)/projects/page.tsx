import ProjectsListClient from "@/components/ProjectsListClient";

// R67 D-69 (audit R-261/R-300). The Projects landing PROJEXA never had.
//
// A thin server route by design: the list reads /api/projects in the browser,
// which is the same session-authenticated proxy the top rail's switcher and
// every create screen's background project resolve already use. Nothing about
// the VERIDIAN key leaves the server either way -- see veridian-client.ts.
export default function ProjectsPage() {
  return (
    <div className="flex-1">
      <ProjectsListClient />
    </div>
  );
}
