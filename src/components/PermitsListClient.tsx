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
// R67 F-18: the rows now normally arrive as props, fetched by permits/page.tsx
// on the server inside its Suspense boundary, so this list paints filled on
// first render instead of mounting empty and then fetching. useModuleList
// keeps the client fetch for the cases the server did not cover (a
// ?withinDays= arrival, a project switch) and gives it an AbortController.
// The old effect also read `.then(r => r.json())` with no status check, so an
// /api/permits failure rendered as "No permits yet for this project." -- that
// is R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01 and it is fixed here too.
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { PERMITS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { useModuleList, type ModuleListInitial } from "@/lib/use-module-list";
import { AsOfStamp } from "@/components/AsOfStamp";
import ListScreenFrame from "@/components/ListScreenFrame";

// Exported so permits/page.tsx can type the rows it fetches server-side.
export type Permit = {
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

// R67 F-18: the fallback labels moved to src/lib/module-list-columns.ts so
// this screen's loading skeleton draws the same column heads this table does.

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
  initial = null,
}: {
  projectId: string;
  withinDays?: string;
  registryColumns?: RegistryColumn[] | null;
  initial?: ModuleListInitial<Permit>;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : PERMITS_LIST_COLUMNS;

  const params = new URLSearchParams({ projectId });
  if (withinDays) params.set("withinDays", withinDays);
  else params.set("all", "true");

  const { rows: permits, error, loading, asOf, reload } = useModuleList<Permit>({
    initial,
    url: `/api/permits?${params.toString()}`,
    pick: (d) => d.permits as Permit[] | undefined,
    context: "permits",
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
      {asOf !== null && (
        <div className="px-4 pt-2 text-right">
          <AsOfStamp at={asOf} />
        </div>
      )}
      {/* R67 F-31: the bare word "Loading…" is gone. The region now carries
          data-state / aria-busy, and after 3 s it says "Still loading
          permits… <n> s" with a live counter, then offers Retry at 8 s. */}
      <ListScreenFrame label="permits" loading={loading} error={error} rowCount={permits.length} onRetry={reload}>
      {error ? (
        // Never an empty table in place of a failed read: the user must be
        // able to tell "no permits" from "we could not find out".
        <p role="alert" className="px-4 py-6 text-[13px] text-px-error">
          {error}
        </p>
      ) : (
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
      )}
      </ListScreenFrame>
    </ScreenFrame>
  );
}
