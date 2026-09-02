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
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
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
  { label: "Days left", field: "daysToExpiry", type: "number", importance: "High" },
];

// R67 F-02: the labels permits/page.tsx paints in its Suspense fallback, so
// the header row on screen while loading is the header row that stays.
export const PERMITS_FALLBACK_COLUMN_LABELS = COLUMNS.map((c) => c.label);

function daysLeftTone(days: number | null): StatusTone {
  if (days === null) return "neutral";
  if (days < 0) return "late";
  if (days <= 30) return "needs-you";
  return "done";
}

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
          rows={permits as unknown as Record<string, unknown>[]}
          getRowId={(row) => row.id as string}
          // The permit's own document link is minted here, once, by the
          // object screen -- see the register's DTO comment in
          // compliance-tracker's v1/projexa/permits/route.ts.
          onRowClick={(row) => router.push(`/permits/${row.id}`)}
          emptyStateLabel="No permits yet for this project."
          renderCell={{
            daysToExpiry: (row) => {
              const days = (row as unknown as Permit).daysToExpiry;
              const tone = daysLeftTone(days);
              return <StatusBadge tone={tone} label={days === null ? "—" : `${days} day${days === 1 ? "" : "s"}`} />;
            },
          }}
        />
      )}
    </ScreenFrame>
  );
}
