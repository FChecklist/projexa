import ProjectCreateClient from "@/components/ProjectCreateClient";

// R67 D-01: the real route that replaces CreateProjectDialog. Deliberately a
// thin server shell -- unlike every project-SCOPED create screen
// (/permits/new, /labour/new, ...) this one creates the project itself, so
// there is no project to resolve server-side and no reason to make the user
// wait on a /dashboard round-trip before the form appears. The product list
// the form needs is fetched by the client from the same /api/products proxy
// the dialog used.
export default function NewProjectPage() {
  return (
    <div className="flex-1 p-6">
      <ProjectCreateClient />
    </div>
  );
}
