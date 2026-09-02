import type { ReactNode } from "react";

// veridian-ui-kit migration: AppTopbar used to be rendered per-page, with
// each page's title shown in its own sticky header bar. AppHeader (the shared
// package's replacement) is mounted exactly once from (app)/layout.tsx, so
// there's no longer a per-page header bar to put a page-specific title in --
// disclosed, deliberate simplification: each page's real title moves into
// its own content area as a plain heading instead. AppHeader's
// `contextLabel` slot shows the org name instead (see AppTopbar.tsx).
//
// R67 D-13: `subtitle` is the scope the screen actually queried -- the project
// name on Documents -- rendered beside the title in the context tint rather
// than as a second heading. A screen that shows one project's rows has to name
// that project somewhere the reader will look, and the title band is where they
// look. Optional, so every existing caller is unchanged.
export function PageHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <h1 className="font-heading text-xl text-ct-navy mb-1">
      {title}
      {subtitle && (
        <span className="ml-2 text-[15px] font-normal text-[color:var(--color-veri-status-context)]">{subtitle}</span>
      )}
    </h1>
  );
}
