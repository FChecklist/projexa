// veridian-ui-kit migration: AppTopbar used to be rendered per-page, with
// each page's title shown in its own sticky header bar. AppHeader (the shared
// package's replacement) is mounted exactly once from (app)/layout.tsx, so
// there's no longer a per-page header bar to put a page-specific title in --
// disclosed, deliberate simplification: each page's real title moves into
// its own content area as a plain heading instead. AppHeader's
// `contextLabel` slot shows the org name instead (see AppTopbar.tsx).
export function PageHeading({ title }: { title: string }) {
  return <h1 className="font-heading text-xl text-ct-navy mb-1">{title}</h1>;
}
