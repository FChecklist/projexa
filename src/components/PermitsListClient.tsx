"use client";

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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { StatusPillTone } from "@/components/ui/status-pill";
import {
  parseWithinDays,
  permitHeaderParts,
  permitStatus,
  permitStatusCounts,
  sortByExpiryAscending,
} from "@/components/permit-status";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

type Permit = {
  id: string;
  name: string;
  permitNumber: string | null;
  permitAuthority: string | null;
  issueDate: string | null;
  endDate: string | null;
  daysToExpiry: number | null;
  // R67 F-02: the register no longer mints a Supabase Storage signed URL per
  // row. It says whether the permit has a file; the URL is minted on click,
  // by the object screen the row already opens.
  hasDocument: boolean;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// intentionally the same fields as ScreenColumn so a registry row can be
// passed straight to ListScreen with no reshaping.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "Permit no.", field: "permitNumber", type: "text", importance: "High" },
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Authority", field: "permitAuthority", type: "text", importance: "High" },
  { label: "Issue date", field: "issueDate", type: "date", importance: "High" },
  { label: "Expiry date", field: "endDate", type: "date", importance: "High" },
  // R67 G-01: was "Days left", which promised a number. The cell now answers
  // a question, so the header asks one.
  { label: "Status", field: "daysToExpiry", type: "text", importance: "High" },
];

// R67 F-02: the labels permits/page.tsx paints in its Suspense fallback, so
// the header row on screen while loading is the header row that stays.
export const PERMITS_FALLBACK_COLUMN_LABELS = COLUMNS.map((c) => c.label);

export default function PermitsListClient({
  projectId,
  withinDays,
  registryColumns,
}: {
  projectId: string;
  withinDays?: string;
  registryColumns?: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;

  // R67 F-02: this used to be a bare fetch().then().then() with no status
  // check, so an error body parsed fine, `data.permits` came back undefined
  // and `?? []` reported a FAILED request as "no permits yet" -- the exact
  // R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01 defect fetchJson() exists to
  // kill (see src/lib/fetch-json.ts). A failure now shows the backend's own
  // words, with Retry.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ projectId });
      if (withinDays) params.set("withinDays", withinDays);
      else params.set("all", "true");
      const data = await fetchJson(`/api/permits?${params.toString()}`);
      setPermits(data.permits ?? []);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load permits"));
    } finally {
      setLoading(false);
    }
  }, [projectId, withinDays]);

  useEffect(() => { load(); }, [load]);

  // R67 F-02: warm the create route's chunk so "+ New" opens instantly rather
  // than starting the download on click. Deliberately on MOUNT, not on hover:
  // the header button is the kit's ScreenFrame HeaderActionState, whose type
  // is { label, onClick, disabledReason } with no hover hook, and D-09 rules
  // out both editing @fchecklist/veridian-ui-kit in node_modules and forking
  // ScreenFrame for something this small. One idle prefetch of a route the
  // user is on the list page for is the honest trade.
  useEffect(() => { router.prefetch(`/permits/new?projectId=${projectId}`); }, [router, projectId]);

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
      breadcrumb="Permits"
      newAction={{ label: "+ New", onClick: () => router.push(`/permits/new?projectId=${projectId}`) }}
      // R42 seq23 live-user finding: these rendered as live, enabled,
      // no-op buttons -- clickable but silently did nothing, no error, no
      // feedback. GLOBAL: "ACTIONS ARE DISABLED BY CONDITION, NEVER HIDDEN,
      // NEVER FAIL-AFTER-CLICK. A disabled action shows WHY beside it."
      // Filter/Export aren't built for this module yet -- say so instead of
      // faking availability.
      exportAction={{ label: "Export", disabledReason: "Not yet available" }}
      filterAction={{ label: "Filter", disabledReason: "Not yet available" }}
      // R67 G-01: status at HEADER level as well as item level. Same three
      // glyphs, same three tones, same counts as the rows beneath -- so the
      // answer to "is anything wrong here" costs no scanning.
      headerMessageStrip={
        loading ? null : (
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
      messages={[]}
    >
      {/* R67 F-02: the real column headers while loading, not the word
          "Loading…" over an empty pane. */}
      {loading ? (
        <TableLoadingRows headers={columns.map((c) => c.label)} rows={3} caption="Loading permits..." />
      ) : loadError ? (
        <DataLoadError messages={[loadError]} onRetry={load} />
      ) : (
        <ListScreen
          functionId="permits.list"
          columns={columns}
          rows={rows as unknown as Record<string, unknown>[]}
          getRowId={(row) => row.id as string}
          // The permit's own document link is minted here, once, by the
          // object screen -- see the register's DTO comment in
          // compliance-tracker's v1/projexa/permits/route.ts.
          onRowClick={(row) => router.push(`/permits/${row.id}`)}
          emptyStateLabel="No permits yet for this project."
          renderCell={{
            daysToExpiry: (row) => {
              const status = permitStatus((row as unknown as Permit).daysToExpiry, windowDays);
              return <StatusPillTone tone={status.tone} label={status.label} />;
            },
          }}
        />
      )}
    </ScreenFrame>
  );
}
