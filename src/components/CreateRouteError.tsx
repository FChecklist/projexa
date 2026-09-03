"use client";

// R67 D-55 -- what a create route shows when it cannot open.
//
// THE FAULT (R-184, and correction C-06 which settles what it was NOT):
// /drawings/new rendered a bare "Internal Server Error" card. C-06 replaces
// both earlier attributions with "cause not established in pass 1; the page
// shows a raw error card whenever project resolution fails", and then keeps
// the product rule regardless of cause: "never show a bare 'Internal Server
// Error' card; say what failed and offer Retry".
//
// A Next.js App Router error.tsx under the (app) segment renders INSIDE the
// shell -- the top rail, the Task Master and the composer all stay up, and
// the project context is still mounted, so the breadcrumb still knows where
// the user is. That is the whole difference between "this form did not open"
// and "the application broke": the first is a screen with an exit, the second
// is a wall.
//
// Three exits, deliberately: Retry (React re-renders the segment, which is
// enough whenever the cause was transient), Back to the module's list, and
// the breadcrumb itself.
//
// SCOPE NOTE: this component and the error.tsx files that mount it are D-55's
// half of /drawings/new. The PAGE's own non-throwing branch -- the card it
// renders when resolveSelectedProject() returns an errorMessage rather than
// throwing -- belongs to item D-08 in lane D1, which owns that file.

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectBreadcrumb } from "@/components/ProjectBreadcrumb";
import { sanitiseBackendMessage } from "@/lib/task-errors";

export function CreateRouteError({
  module,
  moduleHref,
  /** "Drawing", "Permit", "BOQ" -- the sentence reads "the {object} form". */
  objectLabel,
  error,
  reset,
}: {
  module: string;
  moduleHref: string;
  objectLabel: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The real exception still reaches the console for whoever is debugging;
    // what the USER sees is the sanitised sentence below.
    console.error(`[${moduleHref}] create route error:`, error);
  }, [error, moduleHref]);

  // The same redaction rule the Task Master uses: an IP, a host:port, a
  // camelCase parameter name or a function id is replaced wholesale rather
  // than shown to a site engineer.
  const detail = error.message?.trim() ? sanitiseBackendMessage(error.message) : null;

  return (
    <div className="flex-1 space-y-4 p-6">
      <ProjectBreadcrumb
        module={module}
        moduleHref={moduleHref}
        trail={[`New ${objectLabel}`]}
        backHref={moduleHref}
      />

      <div
        role="alert"
        className="max-w-2xl rounded-lg border border-px-error-border bg-px-error-light p-4 text-sm"
      >
        <p className="font-medium text-px-error">Could not open the {objectLabel} form</p>
        {detail && <p className="mt-1 text-px-error/90">{detail}</p>}
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={reset}>
            <RotateCcw className="mr-2 size-4" aria-hidden />
            Retry
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={moduleHref}>Back</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CreateRouteError;
