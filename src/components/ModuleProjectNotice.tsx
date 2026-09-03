// R67 F-18 -- the two non-data outcomes of resolving a project, in one place.
//
// Eleven module pages carried the identical pair inline:
//
//   {errorMessage && <Card className="border-px-error-border ...">…</Card>}
//   {!errorMessage && !project && <Card>No active projects yet.</Card>}
//
// and the error half of that pair was the INERT red box ProjectLoadError was
// written to replace (see its own header comment) -- most of these pages never
// adopted it. Collapsing the pair here fixes that everywhere at once: a failed
// read gets the backend's own words AND a Retry, and only a SUCCESSFUL read is
// allowed to say "No active projects yet" (read-outcome.ts's rule -- "we could
// not find out" is never "zero").
import ProjectLoadError from "@/components/ProjectLoadError";
import { Card, CardContent } from "@/components/ui/card";

export function ModuleProjectNotice({ errorMessage }: { errorMessage: string | null }) {
  if (errorMessage) return <ProjectLoadError message={`Could not load projects: ${errorMessage}`} />;
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-px-muted">No active projects yet.</CardContent>
    </Card>
  );
}

export default ModuleProjectNotice;
