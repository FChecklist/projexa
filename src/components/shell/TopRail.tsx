"use client";

// R67 WS-A (A-16) -- PROJEXA'S FORK of the kit's shell/TopRail.
//
// WHY A FORK AND NOT A KIT CHANGE (decision D-09): the kit is a pinned git
// dependency whose source is not on this machine, and a node_modules edit is
// erased by CI's `bun install --frozen-lockfile`. A-16 itself allows for this
// -- "TopRail's label prop, or a kit prop if the rail cannot show a message" --
// and the kit's rail cannot: `organisationName` is typed `string`, so the only
// thing it can say about a failed read is a word, with no control beside it.
//
// WHAT CHANGED FROM THE KIT COPY, and nothing else did:
//
//   `organisationName: string` becomes `organisation: ReactNode`.
//
// That is the whole diff. It lets the shell render "Organisation unavailable"
// with a real [Retry] button in the one band M24 says is never covered, instead
// of the bare em-dash the kit's string fallback produced -- a single
// punctuation mark standing in for the organisation's name, indistinguishable
// from a name still loading, an org with no name, and a 500.
//
// Everything else -- the band's own rule, the project null state, the tint, the
// aria-live on the project name -- is the kit's, verbatim, and must stay that
// way: this is a type widening, not a redesign.

import type { ReactNode } from "react";

export type TopRailProject = { id: string; name: string };

export type TopRailProps = {
  brand: ReactNode;
  /**
   * A-16: a NODE, not a string. The organisation slot has to be able to carry
   * "Organisation unavailable — [Retry]", which is a sentence and a control.
   */
  organisation: ReactNode;
  /** null renders M24's null state. The selector NEEDS one: "THE PROJECT
   *  SELECTOR NEEDS A NULL STATE ('All projects') so CRM, pipeline and
   *  org-level work are reachable." */
  project: TopRailProject | null;
  onSwitchProject: () => void;
  search?: ReactNode;
  alerts?: ReactNode;
  account?: ReactNode;
};

/** M24's null state, and the string HOME teaches a new user with. */
export const ALL_PROJECTS_LABEL = "All projects";

export function TopRail({ brand, organisation, project, onSwitchProject, search, alerts, account }: TopRailProps) {
  return (
    <header
      className="flex h-9 shrink-0 items-center gap-3 border-b px-3"
      style={{
        borderColor: "var(--color-ct-border)",
        background: "var(--color-ct-cream)",
      }}
    >
      <div className="flex items-center" style={{ color: "var(--color-ct-navy)" }}>
        {brand}
      </div>

      <span aria-hidden style={{ color: "var(--color-ct-border2)" }}>
        /
      </span>

      <span className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--color-ct-slate)" }}>
        {organisation}
      </span>

      <span aria-hidden style={{ color: "var(--color-ct-border2)" }}>
        /
      </span>

      {/* THE PROJECT. Tinted so it reads as the one piece of context you act
          against, using the kit's existing scope-tint tokens rather than a new
          colour (M24-B / E-118: the palette is not to be re-invented).
          aria-live so a switch is announced -- acting on the wrong project is
          the expensive mistake, and a screen-reader user gets no tint. */}
      <button
        type="button"
        onClick={onSwitchProject}
        aria-label={
          project
            ? `Project: ${project.name}. Click to switch project.`
            : "No project selected. Click to choose a project."
        }
        className="rounded-md border px-2 py-0.5 text-[12px] font-medium"
        style={{
          background: "var(--color-scope-tint)",
          borderColor: "var(--color-scope-tint-border)",
          color: "var(--color-ct-navy)",
        }}
      >
        <span aria-live="polite">{project ? project.name : ALL_PROJECTS_LABEL}</span>
        <span aria-hidden className="ml-1.5" style={{ color: "var(--color-ct-muted)" }}>
          ▾
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {search}
        {alerts}
        {account}
      </div>
    </header>
  );
}
