"use client";

// GUIDED ERRORS G1 -- what a project-scoped screen (Scope of Work, New BOQ, Import BOQ) says when it cannot establish WHICH project it is about:
//   none-chosen  the organisation has projects but none is chosen        -> "Choose a project first", Fix it now = the project list
//   none-exist   the organisation has no project at all                  -> "Create your first project", Fix it now = New Project
//   load-failed  the project list itself could not be read               -> the server's words, what to do, Try again
// One inline panel (role="alert") with the way back; never a bare sentence or an empty form that cannot be saved.

import { useMemo } from "react";
import { ActionFailurePanel, codedFailure, type ActionFailureState } from "@/components/ActionFailure";

export type NoProjectKind = "none-chosen" | "none-exist" | "load-failed";

export function NoProjectGuide({ kind, message, moduleLabel }: { kind: NoProjectKind; message?: string | null; moduleLabel?: string }) {
  const failure = useMemo<ActionFailureState>(() => {
    const subject = moduleLabel ? `${moduleLabel} belong` : "This screen belongs";
    if (kind === "none-exist") return codedFailure("NO_PROJECTS_YET", `${subject} to a project, and this organisation has no project yet.`);
    if (kind === "load-failed") {
      return { err: Object.assign(new Error(message?.trim() || "The project list could not be read."), { apiPath: "/api/projects", method: "GET" }), at: 0 };
    }
    return codedFailure("NO_PROJECT", `${subject} to one project, and no project is chosen yet.`);
  }, [kind, message, moduleLabel]);
  return (
    <div className="max-w-3xl" data-testid="no-project-guide" data-kind={kind}>
      <ActionFailurePanel failure={failure} entityType="project" retryable={kind === "load-failed"} onRetry={kind === "load-failed" ? () => window.location.reload() : undefined} quiet={kind !== "load-failed"} />
    </div>
  );
}

export default NoProjectGuide;
