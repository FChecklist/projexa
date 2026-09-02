"use client";

// R67 D-70 (audit R-262). What a create route renders when it has no project to
// write against.
//
// THE DEFECT, in 23 files. Every create page in this app began the same way --
// resolve the project list, and if that failed, `return` a bare Card holding the
// raw error string. So a failing VERIDIAN /dashboard replaced the entire right
// pane with the words "Internal Server Error": no breadcrumb, no title, no Back,
// no Retry, and nothing saying what had failed or what to do next. The user's
// only escape was the browser's own back button. D-08 fixed exactly one of those
// pages, by hand, for drawings; this is the shared version of that fix and the
// other 22 now render it.
//
// It is the SAME frame the create screen itself uses (the forked ObjectScreen),
// so the page keeps its breadcrumb, its title and its Back control, and the
// failure is reported INSIDE the screen rather than instead of it. Save stays
// visible and disabled, stating the one reason that outranks every field:
// "Save (project list unavailable)".
//
// Two states, because they are two different facts:
//   * `message` set  -> the read FAILED. Banner, Retry, Back to <module>.
//   * `message` null -> the read SUCCEEDED and this organisation has no projects
//                       yet. That is not an error and must not be dressed as
//                       one; the way out is to create the first project.
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import { PROJECT_LIST_UNAVAILABLE_REASON, projectListFailureBanner } from "@/lib/project-selection";

export default function CreateScreenUnavailable({
  breadcrumb,
  title,
  backHref,
  backLabel,
  message,
}: {
  /** "Permits / New Permit" -- the same breadcrumb the working screen shows. */
  breadcrumb: string;
  /** "New Permit" -- likewise. */
  title: string;
  /** "/permits" */
  backHref: string;
  /** "Back to Permits" */
  backLabel: string;
  /** resolveSelectedProject's own backend message, or null when the org simply has no projects. */
  message: string | null;
}) {
  const router = useRouter();
  const failed = message !== null;

  return (
    <ObjectScreen
      breadcrumb={breadcrumb}
      title={title}
      mode="create"
      hasDraft={false}
      onBack={() => router.push(backHref)}
      onCancel={() => router.push(backHref)}
      saveDisabled
      saveDisabledReason={failed ? PROJECT_LIST_UNAVAILABLE_REASON : "no project to add this to"}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {failed ? (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-[color:var(--color-veri-status-late)] bg-[color:var(--color-veri-status-late)]/5 p-3 text-[13px]"
          >
            <p>{projectListFailureBanner(message)}</p>
            <div className="flex items-center gap-3">
              {/* Retry re-runs the SERVER fetch. router.refresh() is the only
                  thing that can: the project list is resolved in the page's own
                  server component, so a client-side re-fetch would not change
                  what this screen was rendered with. */}
              <button type="button" onClick={() => router.refresh()} className="font-medium underline">
                Retry
              </button>
              <Link href={backHref} className="font-medium underline">
                {backLabel}
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-[13px] text-ct-muted">
            <p>This organisation has no projects yet, so there is nothing to add this to.</p>
            <Link href="/projects/new" className="font-medium text-ct-navy underline">
              Create the first project
            </Link>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
