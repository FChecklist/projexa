"use client";

// R42 seq21/22 built this against the kit's ListScreen but its COLUMNS
// below was always a hardcoded const, DESPITE this file's own prior comment
// claiming it "reads structurally" from a screen_definitions row -- that
// claim was false (R43 seq2 caught it: compliance.screen_definitions had
// ZERO rows). R43 seq2 makes it real: permits/page.tsx resolves the
// permits.list row server-side via VERIDIAN's /screen-definitions/
// permits.list and passes it down as `registryColumns`. COLUMNS below is
// now ONLY the fallback for when that row doesn't exist yet (404) or the
// call errors.
//
// ─── R67 D-65 / D-59 / D-71: THE READ IS NO LONGER ALLOWED TO LIE ───────
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
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { PaneState } from "@/components/PaneState";
import { useListRead } from "@/lib/use-list-read";
import { recordCountLabel } from "@/lib/pane-state";

type Permit = {
  id: string;
  name: string;
  permitNumber: string | null;
  permitAuthority: string | null;
  issueDate: string | null;
  endDate: string | null;
  daysToExpiry: number | null;
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

function daysLeftTone(days: number | null): StatusTone {
  if (days === null) return "neutral";
  if (days < 0) return "late";
  if (days <= 30) return "needs-you";
  return "done";
}

export default function PermitsListClient({
  projectId,
  projectName,
  withinDays,
  registryColumns,
}: {
  projectId: string;
  projectName?: string | null;
  withinDays?: string;
  registryColumns?: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;

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
  });

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
          <ListScreen
            functionId="permits.list"
            columns={columns}
            rows={permits as unknown as Record<string, unknown>[]}
            getRowId={(row) => row.id as string}
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
        </PaneState>
      </div>
    </ScreenFrame>
  );
}
