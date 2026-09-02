// R67 F-18 -- the frame a module route paints while its rows are still in
// flight. Rendered by each route's loading.tsx and as the fallback of the
// in-page <Suspense> boundary, so a hard load and a client-side navigation
// show the same thing.
//
// THE RULE IT IMPLEMENTS. A screen may not answer with a bare spinner, and it
// may not answer with a frame that is a different shape from the one the data
// arrives into. So the skeleton is the REAL screen: the module's own title,
// its real column headings (from module-list-columns.ts, the same array the
// client falls back to), and five placeholder rows -- five because that is
// what fits above the fold on these tables, so the page does not jump when
// the rows land.
//
// The header actions are rendered, disabled, with the reason "Loading…" beside
// them, rather than omitted. GLOBAL: "ACTIONS ARE DISABLED BY CONDITION, NEVER
// HIDDEN, NEVER FAIL-AFTER-CLICK. A disabled action shows WHY beside it." An
// action that vanishes and reappears is its own kind of layout jump, and a
// live-looking button over a screen with no data yet is a fail-after-click.
// R67 F-31: the same 3 s / 8 s words a CLIENT-side load shows. A <Suspense>
// fallback is a wait like any other -- the row above it is being fetched on the
// server, and the user cannot tell the difference -- so it must not be the one
// place in the app that still answers a long wait with a silent skeleton.
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { PageHeading } from "@/components/PageHeading";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListLoadingWords } from "@/components/ListScreenFrame";

export const SKELETON_ROWS = 5;
export const LOADING_REASON = "Loading…";

export type ModuleListSkeletonProps = {
  columns: ScreenColumn[];
  /** The header buttons this screen really has, shown disabled while loading. */
  actions?: string[];
  /** The screen's real tab labels, so a tabbed module keeps its own shape. */
  tabs?: string[];
  /**
   * What the user asked for, in their words ("minutes", "roster", "permits").
   * Given, the skeleton says "Still loading <label>… <n> s" after 3 s and
   * "This is taking longer than usual" at 8 s. Omitted only where the caller
   * genuinely has no single noun for what is in flight.
   */
  label?: string;
};

/**
 * Everything BELOW the title. Used as the fallback of the in-page <Suspense>
 * boundary, where page.tsx has already streamed the heading -- rendering the
 * title again there would draw it twice for the length of the fetch.
 */
export function ModuleListSkeletonBody({ columns, actions = [], tabs = [], label }: ModuleListSkeletonProps) {
  return (
    <div className="space-y-6" data-state="loading" aria-busy="true">
      {tabs.length > 0 && (
        <div className="flex items-center gap-2">
          {tabs.map((tab) => (
            <span
              key={tab}
              className="rounded-md border px-3 py-1.5 text-sm text-px-muted"
              style={{ borderColor: "var(--color-ct-border)" }}
            >
              {tab}
            </span>
          ))}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-px-muted">{LOADING_REASON}</span>
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              disabled
              aria-disabled="true"
              title={LOADING_REASON}
              className="rounded-md border px-3 py-1.5 text-sm text-px-muted opacity-60"
              style={{ borderColor: "var(--color-ct-border)" }}
            >
              {action}
            </button>
          ))}
        </div>
      )}

      <Card className="shadow-card">
        <CardContent className={columns.length === 0 ? "space-y-3 p-4" : "p-0"}>
          {/* A screen with no table of its own (Reports, whose body is a
              picker and a result panel) still gets five placeholder bars
              rather than a spinner. */}
          {columns.length === 0 ? (
            Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" data-testid="module-list-skeleton-row" />
            ))
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.field}>{col.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <TableRow key={i} data-testid="module-list-skeleton-row">
                  {columns.map((col) => (
                    <TableCell key={col.field}>
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      {label ? <ListLoadingWords label={label} /> : null}
    </div>
  );
}

/** The whole frame, title included. Used by each route's loading.tsx. */
export function ModuleListSkeleton({ title, ...body }: ModuleListSkeletonProps & { title: string }) {
  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title={title} />
      <ModuleListSkeletonBody {...body} />
    </div>
  );
}

export default ModuleListSkeleton;
