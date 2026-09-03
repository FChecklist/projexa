// veridian-ui-kit migration: AppTopbar used to be rendered per-page, with
// each page's title shown in its own sticky header bar. AppHeader (the shared
// package's replacement) is mounted exactly once from (app)/layout.tsx, so
// there's no longer a per-page header bar to put a page-specific title in --
// disclosed, deliberate simplification: each page's real title moves into
// its own content area as a plain heading instead. AppHeader's
// `contextLabel` slot shows the org name instead (see AppTopbar.tsx).
//
// R67 E-37 (R-269): `breadcrumb` is optional and additive -- no existing
// caller changes. The company hierarchy needs to say WHICH organisation it is
// showing, because that page's whole subject is an org's own structure and a
// reader who cannot see the org name cannot tell whether the empty state below
// is about their company or somebody else's.
export function PageHeading({ title, breadcrumb }: { title: string; breadcrumb?: string }) {
  return (
    <div className="mb-1">
      {breadcrumb && (
        <p className="text-[12px] text-ct-muted" data-testid="page-breadcrumb">
          {breadcrumb}
        </p>
      )}
      <h1 className="font-heading text-xl text-ct-navy">{title}</h1>
    </div>
  );
}
