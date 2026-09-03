// R67 F-19 -- the frame a create route paints while it is still working out
// which project it is for.
//
// This is the RARE path: every "+ New" button, KPI tile and pill already puts
// ?projectId= in the URL, and the projexa_project cookie covers a typed or
// bookmarked one, so the page normally renders the real form with no await at
// all. This is what a user sees only when neither source knows and the
// /dashboard hop has to run -- and even then they get the form's shape rather
// than a blank screen, which is what the audit measured: 1.5-1.65 s of nothing
// for forms of three to seven fields.
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function CreateFormSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div className="space-y-4" data-state="loading" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-64" />
      <Card className="shadow-card">
        <CardContent className="space-y-4 p-4">
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * What a create route says when no project can be established at all.
 *
 * Unlike the list screens this is a hard stop -- there is nothing to create
 * against -- so it names the reason (the backend's own words when there are
 * any) rather than showing an empty form that cannot be saved.
 */
export function CreateProjectMissing({ message }: { message?: string | null }) {
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-px-muted">
        {message ?? "No active project selected."}
      </CardContent>
    </Card>
  );
}

export default CreateFormSkeleton;
