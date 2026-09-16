"use client";

// R67 D-66 / D-04 / A-16 -- PROJEXA's FORK of the kit's TopRail.
//
// TWO LANES FORKED THIS FILE FOR TWO REASONS AND BOTH ARE KEPT. D-66 needed a
// real project SELECTOR (below); A-16 needed the organisation slot to be able
// to carry a sentence and a control -- "Organisation unavailable - [Retry]" --
// instead of the bare em-dash the kit's `organisationName: string` produced,
// which is indistinguishable from a name still loading, an org with no name,
// and a 500. The two changes touch different halves of the rail and compose
// without either being weakened: `organisation` is a ReactNode, and the
// project control is a listbox.
//
// WHY A FORK AND NOT A KIT CHANGE: programme decision D-09. The
// @fchecklist/veridian-ui-kit source is not on this machine and is consumed
// as a pinned git tarball; a change there needs a release and a version
// bump, which this programme does not do. So the file is copied here, the
// one thing that had to change is changed, and everything else the kit
// exports is still imported from the kit unchanged.
//
// WHAT HAD TO CHANGE: the kit's `onSwitchProject` is a bare callback, and
// PROJEXA's shell used it to CYCLE -- click once for the next project, click
// past the end for "All projects". That is not a selector. With five
// projects, reaching the third costs three clicks and there is no moment at
// which the user can see the list they are choosing from; the rail even
// renders a "▾" affordance promising a menu that never opened. M24's own
// sentence is the reason this matters:
//
//   "THE PROJECT MUST BE VISIBLE AT ALL TIMES ... Logging progress or a
//    variation against the wrong project is the most expensive mistake
//    available in this product."
//
// A control you cannot see the options of is how that mistake gets made.
// This fork opens a real list: "All projects" on top, then every project,
// with the current one marked -- one click to open, one to choose.
//
// Everything else -- the band's own rule, the project null state, the tint,
// the aria-live on the project name -- is the kit's, verbatim, and must stay
// that way.
//
// WHAT IS DELIBERATELY NOT HERE: a per-project status glyph. The item asks
// for one, but PROJEXA's /api/projects returns id and name only, and
// VERIDIAN's dashboard summary behind it carries no project status column at
// all. A glyph would therefore have to be invented, and a made-up status on
// the one control M24 calls the most expensive to get wrong is worse than no
// glyph. When a real status reaches this payload, it renders here.
//
// OWNER FIX, 2026-09-14 -- "+ Add new project" added to the end of this same
// list (`onCreateProject`, optional). No new create-project flow: it opens
// the real, already-shipped `/projects/new` route (`ProjectCreateClient.tsx`,
// R67 D-01) -- the same route `DashboardHomeView.tsx`'s "Create Project"/
// "New project" buttons, `ProjectsListClient.tsx`'s "New" action, and
// `ProjectsOverviewClient.tsx`'s "Create" button already navigate to. This is
// a second entry point into that one flow, same precedent as `openSignal`
// giving the breadcrumb and the "pick a project" card a second door into
// this same switcher rather than each growing its own.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type TopRailProject = { id: string; name: string };

export type TopRailProps = {
  brand: ReactNode;
  /**
   * A-16: a NODE, not a string. The organisation slot has to be able to carry
   * "Organisation unavailable - [Retry]", which is a sentence and a control.
   */
  organisation: ReactNode;
  /** null renders M24's null state -- "All projects". */
  project: TopRailProject | null;
  /** Every project the user may switch to. Empty while the list is loading. */
  projects: TopRailProject[];
  /** null means "All projects". */
  onSelectProject: (project: TopRailProject | null) => void;
  /**
   * OWNER FIX, 2026-09-14 -- "+ Add new project" entry at the end of this
   * list. Optional and additive: omitting it (no caller update required)
   * renders the switcher exactly as before. When supplied, M24Shell.tsx
   * wires it to the SAME route the app's own nav/home screen already use to
   * create a project (`/projects/new`, `ProjectCreateClient.tsx`) -- this
   * file does not invent a new create-project flow, only a second entry
   * point into the one that already exists, same precedent as `openSignal`
   * below giving the breadcrumb and the "pick a project" card a second door
   * into this same list rather than each growing a switcher of their own.
   */
  onCreateProject?: () => void;
  /**
   * R67 D-66: a monotonic counter the shell increments when something ELSE
   * asks for the switcher -- the breadcrumb's project name, the "pick a
   * project" chooser card. A counter rather than a boolean because a second
   * request has to open the list a second time, and a boolean that is already
   * true does nothing.
   */
  openSignal?: number;
  search?: ReactNode;
  alerts?: ReactNode;
  account?: ReactNode;
};

/** M24's null state, and the string HOME teaches a new user with. */
export const ALL_PROJECTS_LABEL = "All projects";

export function TopRail({
  brand,
  organisation,
  project,
  projects,
  onSelectProject,
  onCreateProject,
  openSignal,
  search,
  alerts,
  account,
}: TopRailProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Opened from elsewhere. The first render is skipped so the list is not
  // hanging open on every page load.
  const seenSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal === undefined || openSignal === seenSignal.current) return;
    seenSignal.current = openSignal;
    setOpen(true);
  }, [openSignal]);

  // Close on Escape and on a click anywhere else. Without both, the list
  // covers the screen the user was trying to get back to -- which is the
  // dead end M24 forbids.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const choose = useCallback(
    (next: TopRailProject | null) => {
      setOpen(false);
      onSelectProject(next);
    },
    [onSelectProject]
  );

  // OWNER FIX, 2026-09-14 -- same close-then-act shape as `choose` above,
  // for the "+ Add new project" entry. Closing first (not left for the
  // navigation to do) matches every other choice in this list: the menu
  // must never still be open over whatever screen the click landed on.
  const createProject = useCallback(() => {
    setOpen(false);
    onCreateProject?.();
  }, [onCreateProject]);

  return (
    <header
      className="flex h-9 shrink-0 items-center gap-3 border-b px-3"
      style={{
        borderColor: "var(--color-ct-border)",
        // 2026-09-07 -- VISUAL-ONLY re-skin to match the frozen mock (owner
        // direction): the mock's header band is a pale lavender, not the
        // kit's cream. Nothing about this bar's behaviour, project-switcher
        // logic, or accessibility changes -- only this one background.
        background: "var(--color-topbar-tint)",
      }}
    >
      <div className="flex items-center" style={{ color: "var(--color-ct-navy)" }}>
        {brand}
      </div>

      <span aria-hidden style={{ color: "var(--color-ct-border2)" }}>
        /
      </span>

      {/* A-16: whatever the shell hands over -- the org's name, or
          "Organisation unavailable" beside a real Retry button. */}
      <span className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--color-ct-slate)" }}>
        {organisation}
      </span>

      <span aria-hidden style={{ color: "var(--color-ct-border2)" }}>
        /
      </span>

      {/* THE PROJECT.
          2026-09-08 -- VISUAL-ONLY, per the owner's explicit mandate ("THE
          FRONT END TO BE 100% COPY OF MOCK UI UX DESIGN"): the frozen
          mock's own DOM (read directly) draws this as a plain WHITE, fully
          rounded pill with no border -- `border-radius: 999px`, `background:
          #fff`, no border at all. This used to be tinted with the kit's
          `--color-scope-tint`/`--color-scope-tint-border` tokens (M24-B /
          E-118's own reasoning: "reads as the one piece of context you act
          against" -- a real, documented decision, not an oversight), which
          drew a cream, 10px-radius, bordered chip instead. The mock's own
          instruction now controls for how this is DRAWN; nothing about
          WHAT it does changes -- same button, same aria-label/aria-live/
          aria-expanded, same onClick, same switcher list underneath it.
          aria-live so a switch is announced -- acting on the wrong project is
          the expensive mistake, and a screen-reader user gets no tint. */}
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={
            project ? `Project: ${project.name}. Click to switch project.` : "No project selected. Click to choose a project."
          }
          className="rounded-full px-2 py-0.5 text-[12px] font-medium"
          style={{
            background: "#fff",
            color: "var(--color-ct-navy)",
          }}
        >
          <span aria-live="polite">{project ? project.name : ALL_PROJECTS_LABEL}</span>
          <span aria-hidden className="ml-1.5" style={{ color: "var(--color-ct-muted)" }}>
            ▾
          </span>
        </button>

        {open && (
          <ul
            role="listbox"
            aria-label="Switch project"
            className="absolute left-0 top-full z-50 mt-1 max-h-80 min-w-56 overflow-auto rounded-md border py-1 shadow-lg"
            style={{ background: "var(--color-ct-cream)", borderColor: "var(--color-ct-border)" }}
          >
            <li>
              <button
                type="button"
                role="option"
                aria-selected={project === null}
                onClick={() => choose(null)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:underline"
                style={{ color: project === null ? "var(--color-veri-status-context)" : "var(--color-ct-navy)" }}
              >
                <span aria-hidden className="w-3">
                  {project === null ? "✓" : ""}
                </span>
                {ALL_PROJECTS_LABEL}
              </button>
            </li>
            {projects.map((p) => {
              const selected = project?.id === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(p)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:underline"
                    style={{ color: selected ? "var(--color-veri-status-context)" : "var(--color-ct-navy)" }}
                  >
                    <span aria-hidden className="w-3">
                      {selected ? "✓" : ""}
                    </span>
                    {p.name}
                  </button>
                </li>
              );
            })}
            {projects.length === 0 && (
              // Honest: the list is genuinely empty or has not answered yet.
              // An empty menu with no explanation reads as a broken control.
              <li className="px-3 py-1.5 text-[12px]" style={{ color: "var(--color-ct-muted)" }}>
                No projects to switch to yet.
              </li>
            )}
            {/* OWNER FIX, 2026-09-14 -- "+ Add new project", always last so
                the switcher's real job (choosing among existing projects)
                still reads first. A hairline border-t separates it from the
                choices above it, same token ControlStrip.tsx's own
                border-t already uses, so it reads as a distinct action
                rather than one more option in the list. Renders only when
                the caller wires `onCreateProject` -- omitting the prop
                keeps every existing render byte-for-byte the same. */}
            {onCreateProject && (
              <li className="border-t" style={{ borderColor: "var(--color-ct-border)" }}>
                <button
                  type="button"
                  onClick={createProject}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium hover:underline"
                  style={{ color: "var(--color-veri-status-context)" }}
                >
                  <span aria-hidden className="w-3">
                    +
                  </span>
                  Add new project
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {search}
        {alerts}
        {account}
      </div>
    </header>
  );
}

export default TopRail;
