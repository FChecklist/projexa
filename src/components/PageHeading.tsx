// veridian-ui-kit migration: AppTopbar used to be rendered per-page, with
// each page's title shown in its own sticky header bar. AppHeader (the shared
// package's replacement) is mounted exactly once from (app)/layout.tsx, so
// there's no longer a per-page header bar to put a page-specific title in --
// disclosed, deliberate simplification: each page's real title moves into
// its own content area as a plain heading instead. AppHeader's
// `contextLabel` slot shows the org name instead (see AppTopbar.tsx).
//
// R67 D-20: `context` is the project (or other scope) the screen is showing,
// rendered in the kit's own context tint so the heading, the top rail and
// the composer root all name the same thing in the same colour -- the split
// this item exists to close. Optional and additive: every existing caller
// passes only `title` and renders byte-identically.
export function PageHeading({
  title,
  context,
  contextNote,
}: {
  title: string;
  context?: string | null;
  contextNote?: string | null;
}) {
  return (
    <h1 className="font-heading text-xl text-ct-navy mb-1">
      {title}
      {context ? (
        <>
          {" - "}
          <span style={{ color: "var(--color-veri-status-context)" }}>{context}</span>
        </>
      ) : null}
      {contextNote ? <span className="ml-2 align-middle text-sm text-px-muted">{contextNote}</span> : null}
    </h1>
  );
}
