"use client";

// R67 D-66 -- "{Project} / {Module}", from the one ProjectContext.
//
// R-253: the rail said "All projects" while the breadcrumb underneath it said
// "Dashboard / Cedar Heights Villa - Phase 1". This component makes that
// disagreement impossible by construction -- it does not take a project as a
// prop. There is nowhere for a second answer to come from.
//
// The project segment is a BUTTON, tinted with the same
// --color-veri-status-context the rail and the page heading use, and clicking
// it opens the rail's switcher. R-253's own words: the breadcrumb project is
// "a click that opens the switcher". A tinted word that does nothing when
// clicked is a worse control than plain text.
//
// D-67's create form is the same breadcrumb with a Back control in front and
// the object appended: "← Back  Cedar Heights Villa / Permits / New Permit".

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ALL_PROJECTS_LABEL } from "@/components/shell/TopRail";
import { useProjectScope } from "@/components/shell/project-context";

export type ProjectBreadcrumbProps = {
  /** The module's own name, as the user reads it: "Permits", "Minutes of Meeting". */
  module: string;
  /** Where the module's list lives. Omit for a module with no list route. */
  moduleHref?: string;
  /** Segments after the module: ["New Permit"], ["BP-2026-0142"]. */
  trail?: string[];
  /** Renders "← Back" in front, pointing here. */
  backHref?: string;
  backLabel?: string;
};

function Separator() {
  return (
    <span aria-hidden className="px-1.5 text-px-muted">
      /
    </span>
  );
}

export function ProjectBreadcrumb({
  module,
  moduleHref,
  trail = [],
  backHref,
  backLabel = "Back",
}: ProjectBreadcrumbProps) {
  const { project, openSwitcher } = useProjectScope();

  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-0.5 text-[13px]">
      {backHref && (
        <Link
          href={backHref}
          className="mr-2 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium text-ct-navy hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {backLabel}
        </Link>
      )}

      {/* Under "All projects" the segment still renders and still opens the
          switcher -- the scope is always stated, never left blank. */}
      <button
        type="button"
        onClick={openSwitcher}
        className="rounded px-1 py-0.5 font-medium hover:underline"
        style={{ color: "var(--color-veri-status-context)" }}
        aria-label={
          project ? `Project: ${project.name}. Click to switch project.` : "No project selected. Click to choose a project."
        }
      >
        {project ? project.name : ALL_PROJECTS_LABEL}
      </button>

      <Separator />

      {moduleHref ? (
        <Link href={moduleHref} className="rounded px-1 py-0.5 text-ct-navy hover:underline">
          {module}
        </Link>
      ) : (
        <span className="px-1 py-0.5 text-ct-navy">{module}</span>
      )}

      {trail.map((segment) => (
        <span key={segment} className="flex items-center">
          <Separator />
          <span className="px-1 py-0.5 text-px-muted">{segment}</span>
        </span>
      ))}
    </nav>
  );
}

export default ProjectBreadcrumb;
