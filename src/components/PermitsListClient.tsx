"use client";

// R67 MERGE (lane D0 x lane F2). Both lanes rewrote this list's data path:
// lane D0 onto useListRead()/PaneState, lane F2 onto useModuleList()/
// ListScreenFrame. Under decision D-11 the version on main is canonical, so
// useListRead() and PaneState stay and lane F2's two distinct capabilities are
// folded into them rather than duplicated beside them:
//
//   * F-18's SERVER-SEEDED FIRST PAINT. The page fetched these rows already,
//     inside its Suspense boundary; `initial` hands them straight to the hook,
//     which then makes no round trip on first paint. A server-side failure
//     seeds the error state -- never a spinner, never an empty table.
//   * F-18's SHARED COLUMN CONSTANTS. The fallback labels come from
//     src/lib/module-list-columns.ts, the same list the page's loading skeleton
//     draws, so a skeleton head and a table head can no longer disagree.
//
// F-31's machine-readable data-state was folded into PaneState itself, so it
// covers this screen (and every other) without a second wrapper.

// R42 seq21/22 built this against the kit's ListScreen but its COLUMNS
// below was always a hardcoded const, DESPITE this file's own prior comment
// claiming it "reads structurally" from a screen_definitions row -- that
// claim was false (R43 seq2 caught it: compliance.screen_definitions had
// ZERO rows). R43 seq2 makes it real: permits/page.tsx resolves the
// permits.list row server-side via VERIDIAN's /screen-definitions/
// permits.list and passes it down as `registryColumns`. COLUMNS below is
// now ONLY the fallback for when that row doesn't exist yet (404) or the
// call errors -- kept, per r43_queue seq2's own instruction, until the
// registry path is verified live, then removable in a follow-up PR once
// every screen using this pattern has a seeded row.
//
// R67 G-01 (R-017): the "Days left" cell no longer renders a bare signed
// number in a coloured chip. See src/components/permit-status.ts for what
// changed and why; this file only renders what that module decides, and adds
// the two things a pure function cannot: the header band (status at header
// level as well as item level) and the filtered-view banner.
//
// â”€â”€â”€ R67 D-65 / D-59 / D-71: THE READ IS NO LONGER ALLOWED TO LIE â”€â”€â”€â”€â”€â”€â”€
//
// BEFORE, in full:
//
//   fetch(`/api/permits?...`)
//     .then((r) => r.json())            // status never read
//     .then((data) => setPermits(data.permits ?? []))   // error body -> []
//     .finally(() => setLoading(false));
//
// A 500 parsed cleanly as JSON, `data.permits` came back undefined, `?? []`
// produced an empty array, and the kit's ListScreen then rendered "0
// records" and "No permits yet for this project." -- on a project with
// permits, with no error anywhere on screen and no way to tell a broken
// backend from an empty one. There was not even a catch: a network failure
// left the spinner up forever.
//
// AFTER: the outcome is held (loading | error | ready) and PaneState decides
// what may be said. The empty sentence is reachable only from a 200. The
// kit's ListScreen is rendered ONLY when there are rows to put in it --
// per D-09 the kit stays unchanged, and handing it rows:[] is precisely how
// its own "0 records" got onto a failed screen.
//
// D-71 finishes the job: the twenty lines of load-state bookkeeping that
// stood here are now useListRead(), the one shared list hook, so the rule
// lives in a tested module instead of being re-typed per screen.
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, type FieldMessage, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { PaneState } from "@/components/PaneState";
import { useListRead } from "@/lib/use-list-read";
import { PERMITS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { type ModuleListInitial } from "@/lib/module-list-state";
import { recordCountLabel } from "@/lib/pane-state";
import { useEffect, useState } from "react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { takeScreenMessage } from "@/lib/screen-message";
import { StatusPillTone } from "@/components/ui/status-pill";
import {
  parseWithinDays,
  permitHeaderParts,
  permitStatus,
  permitStatusCounts,
  sortByExpiryAscending,
} from "@/components/permit-status";

// Exported so permits/page.tsx can type the rows it fetches server-side.
export type Permit = {
  id: string;
  name: string;
  permitNumber: string | null;
  permitAuthority: string | null;
  issueDate: string | null;
  endDate: string | null;
  daysToExpiry: number | null;
  // R67 D-05: C01-15 removes the per-row signed URL from the list response
  // and replaces it with this boolean (a signed URL per row is a Storage
  // round-trip per row, and they expire in 300s anyway). Both shapes are
  // read here so the Document column is correct before and after that lands.
  hasDocument?: boolean;
  documentUrl?: string | null;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// intentionally the same fields as ScreenColumn so a registry row can be
// passed straight to ListScreen with no reshaping.
export type RegistryColumn = ScreenColumn;

// R67 D-05 (lane D1, folded in). Affordance columns, appended to whichever
// column set is in force (registry row or the shared fallback) because they are
// not data the registry describes -- they are how a row says what it can do.
// Deliberately NOT importance "High": ListScreen caps High columns at 7 and
// silently drops the overflow, which would make these two vanish exactly when
// the registry row is fully populated.
const DOCUMENT_COLUMN: ScreenColumn = { label: "Document", field: "__document", type: "text", importance: "Medium" };
const OPEN_COLUMN: ScreenColumn = { label: "Open", field: "__open", type: "text", importance: "Medium" };

/** R67 D-05: does this row have a permit PDF behind it? Tolerates both the
 *  current response (a signed `documentUrl` per row) and C01-15's `hasDocument`
 *  boolean, so the column never silently renders "-" for every row during the
 *  changeover. */
export function rowHasDocument(row: { hasDocument?: boolean; documentUrl?: string | null }): boolean {
  if (typeof row.hasDocument === "boolean") return row.hasDocument;
  return Boolean(row.documentUrl);
}


export default function PermitsListClient({
  projectId,
  projectName,
  withinDays,
  initial = null,
  registryColumns,
}: {
  projectId: string;
  projectName?: string | null;
  withinDays?: string;
  registryColumns?: RegistryColumn[] | null;
  /**
   * R67 F-18: what permits/page.tsx already fetched on the server for this
   * project. Present, the hook starts ANSWERED and makes no round trip on
   * first paint; a server-side failure starts it in the error state, never on
   * a spinner and never on an empty table. Only the first url is seeded, so a
   * project switch or a filter change still reads normally.
   */
  initial?: ModuleListInitial<Permit>;
}) {
  const router = useRouter();
  const base = registryColumns && registryColumns.length > 0 ? registryColumns : PERMITS_LIST_COLUMNS;
  // R67 D-05: the two affordance columns, appended to whichever set is in force.
  const columns = useMemo(
    () => [
      ...base,
      ...(base.some((c) => c.field === DOCUMENT_COLUMN.field) ? [] : [DOCUMENT_COLUMN]),
      ...(base.some((c) => c.field === OPEN_COLUMN.field) ? [] : [OPEN_COLUMN]),
    ],
    [base]
  );

  // R67 D-05: the receipt handed over by a delete on the object page. It is a
  // persistent message in this screen's own band, not a toast, and it is read
  // once (see screen-message.ts).
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  useEffect(() => {
    const handed = takeScreenMessage("permits.list");
    if (handed) setMessages([handed]);
  }, []);

  // R67 D-05: the PDF behind a row, opened in a tab that is opened
  // SYNCHRONOUSLY -- a window.open() after an await is a popup a browser blocks.
  async function openDocument(permitId: string) {
    const tab = window.open("", "_blank");
    try {
      const permit = await fetchJson<Permit>(`/api/permits/${permitId}`);
      if (!permit.documentUrl) {
        tab?.close();
        setMessages([{ level: "error", text: "This permit has no document link on it." }]);
        return;
      }
      if (tab) tab.location.href = permit.documentUrl;
      else window.location.href = permit.documentUrl;
    } catch (err) {
      tab?.close();
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't open the permit document") }]);
    }
  }

  const params = new URLSearchParams({ projectId });
  if (withinDays) params.set("withinDays", withinDays);
  else params.set("all", "true");

  // Rows already held are deliberately NOT cleared by a failed refresh -- the
  // hook keeps them and dates them; see PaneState's "as of 14:32" band.
  const {
    rows: permits,
    status,
    startedAt,
    loadedAt,
    error,
    reload,
  } = useListRead<Permit>({
    url: `/api/permits?${params.toString()}`,
    select: (body) => (body as { permits?: Permit[] } | null)?.permits,
    // The page prefetches the UNFILTERED list only, so a ?withinDays= arrival
    // reads its own filtered set rather than painting the wrong rows.
    initial,
  });

  // R67 G-01: "Default the sort to endDate ascending so the most urgent
  // permit is first." Done here rather than asking the API for an order,
  // because the header counts below are computed from these same rows -- one
  // array, so the summary and the list can never disagree.
  const rows = useMemo(() => sortByExpiryAscending(permits), [permits]);

  // The dashboard's "Permits Expiring" KPI lands here with ?withinDays=30.
  // Arriving on a filtered list with no way to tell it IS filtered is how a
  // user concludes the project has three permits when it has eleven.
  //
  // The route accepts any N, so the WINDOW is read from the parameter and then
  // used everywhere -- the banner sentence, the header clause and the row
  // chips all take the same N. Hard-coding 30 in the sentence while the API
  // filtered on 60 would print "within 30 days" over a 60-day list.
  const filtered = Boolean(withinDays);
  const windowDays = parseWithinDays(withinDays);
  const counts = useMemo(() => permitStatusCounts(rows, windowDays), [rows, windowDays]);
  const headerParts = permitHeaderParts(counts, windowDays);

  return (
    <ScreenFrame
      // R67 D-07: the module already names itself in the page heading above.
      // The frame band names the PROJECT this list queried instead, so the
      // module is not printed twice one line apart.
      breadcrumb={projectName ?? "Permits"}
      // R67 D-07 / C01-13 (lane D1, folded in at the merge). The label was
      // "+ New", and ScreenFrame's HeaderActionButton already renders a Plus
      // ICON before it -- so this one button read "+ + New" while every other
      // list screen in the product (DrawingsClient's own comment states the
      // same rule) passed the plain word. The frame draws the plus.
      newAction={{ label: "New", onClick: () => router.push(`/permits/new?projectId=${projectId}`) }}
      // R42 seq23 live-user finding: these rendered as live, enabled,
      // no-op buttons -- clickable but silently did nothing, no error, no
      // feedback. GLOBAL: "ACTIONS ARE DISABLED BY CONDITION, NEVER HIDDEN,
      // NEVER FAIL-AFTER-CLICK. A disabled action shows WHY beside it."
      // Filter/Export aren't built for this module yet -- say so instead of
      // faking availability.
      // R67 D-59: "(Not yet available)" was the placeholder on both, and the
      // shared ListHeaderActions on Labour/Materials/Schedule says something
      // real. Two conventions for the same disabled control is the finding.
      // Export names the honest reason it has TODAY -- an empty list has
      // nothing to export -- and falls back to the not-built sentence.
      exportAction={{
        label: "Export",
        disabledReason: permits.length === 0 ? "Export — no rows to export" : "Exporting permits is not built yet",
      }}
      filterAction={{ label: "Filter", disabledReason: "Filtering permits is not built yet" }}
      // R67 G-01: status at HEADER level as well as item level. Same three
      // glyphs, same three tones, same counts as the rows beneath -- so the
      // answer to "is anything wrong here" costs no scanning.
      // Gated on a SUCCESSFUL read, not merely on "not loading": over a 500
      // the counts are all zero, and this band would then assert "No permits
      // on this project yet." -- the same false-empty claim D-65 removed from
      // the list itself.
      headerMessageStrip={
        status !== "ready" ? null : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {filtered && (
              <span className="flex flex-wrap items-center gap-2">
                <span>Showing permits expiring within {windowDays} days</span>
                {/* A word-link, not an icon and not a chip: it drops the
                    parameter and shows the whole list. */}
                <button
                  type="button"
                  onClick={() => router.push(`/permits?projectId=${encodeURIComponent(projectId)}`)}
                  className="underline underline-offset-2 hover:no-underline"
                  style={{ color: "var(--brand-text)" }}
                >
                  Show all
                </button>
                {headerParts.length > 0 && <span aria-hidden style={{ color: "var(--color-ct-border2)" }}>|</span>}
              </span>
            )}
            {headerParts.map((part, i) => (
              <span key={part.key} className="flex items-center gap-3">
                {i > 0 && <span aria-hidden style={{ color: "var(--color-ct-border2)" }}>-</span>}
                <StatusPillTone tone={part.tone} label={part.text} />
              </span>
            ))}
            {headerParts.length === 0 && !filtered && <span>No permits on this project yet.</span>}
          </div>
        )
      }
      // R67 D-05: the receipt handed over by a delete on the object page.
      messages={messages}
    >
      <div className="px-1 pb-1">
        {/* The record count is an en-dash until a read has actually
            succeeded -- "0 records" over a 500 is a claim nobody made. */}
        <p className="px-3 py-2 text-[12px] text-px-muted">{recordCountLabel(status, permits.length)}</p>
        <PaneState
          status={status}
          entity="permits"
          projectName={projectName}
          startedAt={startedAt}
          error={error}
          rowCount={permits.length}
          lastLoadedAt={loadedAt}
          skeletonColumns={columns.map((c) => c.label)}
          emptyMessage="No permits yet for this project."
          emptyAction={
            <Button size="sm" onClick={() => router.push(`/permits/new?projectId=${projectId}`)}>
              <Plus className="size-4" aria-hidden /> New
            </Button>
          }
          onRetry={reload}
        >
          {/* R67 G-01: the rows are the SORTED ones, so the list and the
              header counts above are computed from one array and cannot
              disagree. The cell renders what permit-status.ts decides -- a
              glyph and words, never a bare signed number in a chip. */}
          <ListScreen
            functionId="permits.list"
            columns={columns}
            rows={rows as unknown as Record<string, unknown>[]}
            getRowId={(row) => row.id as string}
            onRowClick={(row) => router.push(`/permits/${row.id}`)}
            emptyStateLabel="No permits yet for this project."
            renderCell={{
              __document: (row) => {
                const permit = row as unknown as Permit;
                if (!rowHasDocument(permit)) return <span className="text-ct-muted">-</span>;
                // Every action is a word, never an icon alone. stopPropagation
                // so opening the PDF does not also open the row behind it.
                return permit.documentUrl ? (
                  <a
                    href={permit.documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="underline underline-offset-2"
                  >
                    PDF
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openDocument(permit.id);
                    }}
                    className="underline underline-offset-2"
                  >
                    PDF
                  </button>
                );
              },
              __open: (row) => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/permits/${(row as unknown as Permit).id}`);
                  }}
                  className="underline underline-offset-2"
                >
                  Open
                </button>
              ),
              daysToExpiry: (row) => {
                const rowStatus = permitStatus((row as unknown as Permit).daysToExpiry, windowDays);
                return <StatusPillTone tone={rowStatus.tone} label={rowStatus.label} />;
              },
            }}
          />
        </PaneState>
      </div>
    </ScreenFrame>
  );
}
