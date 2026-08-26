"use client";

// R52 fix for F_022 (/ffe never renders content) and the 22 sibling pages that
// share its shape.
//
// THE DEFECT, established from code rather than from the symptom: every
// project-scoped page is a server component that resolves the project first and
// then gates its whole body on it --
//
//   {errorMessage && <Card>{errorMessage}</Card>}
//   {project && <SomeClient projectId={project.id} />}
//
// When the upstream VERIDIAN call times out (chronic since 2026-07-15;
// veridian-client.ts bounds it at 20s), resolveSelectedProject() catches the
// VeridianApiError and returns project: null. So the page renders its heading
// and an INERT red box, and the module never mounts. The recorded fault reads
// "never renders FF&E content ... the page does start to load", which is
// exactly this branch. It is not a shell bug, not a router bug and not
// specific to /ffe -- /ffe is simply where it was logged.
//
// WHAT THIS CHANGES: the error stops being a dead end. The user gets the
// backend's OWN message (never a generic one -- that is the standing rule for
// this app's errors) plus a control that actually retries, without leaving the
// page or losing the route they were on. router.refresh() re-runs the server
// component, which re-runs the project resolution; a transient 20s timeout
// then costs one click instead of a navigation.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

// R52 Gate 2: `context` added. C19's pass_means is "A clear error naming WHAT
// failed", and the 21 pages that still had the inert red Card said "Could not
// load projects: <backend message>" while the 8 already using this component
// dropped that half and showed the bare backend string. Naming the failed read
// is the better of the two, so it moves in here and every caller gets it --
// rather than 29 call sites each re-deciding how to phrase the same sentence.
export default function ProjectLoadError({
  message,
  context = "Could not load projects",
}: {
  message: string;
  context?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [attempts, setAttempts] = useState(0);

  return (
    <Card className="border-px-error-border bg-px-error-light">
      <CardContent className="space-y-3 p-4">
        {/* The backend's own words. A generic "something went wrong" here would
            hide which upstream is degraded and for how long. */}
        <p role="alert" className="text-sm text-px-error">
          {context}: {message}
        </p>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setAttempts((n) => n + 1);
              startTransition(() => router.refresh());
            }}
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Retrying…
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 size-4" aria-hidden />
                Retry
              </>
            )}
          </Button>
          {attempts > 1 && !pending && (
            // Say the true thing after a couple of failures rather than letting
            // the user keep clicking a control that is not going to work.
            <span className="text-xs text-px-muted">
              Still failing after {attempts} attempts — the workspace backend is degraded, not your connection.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
