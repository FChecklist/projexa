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
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";

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
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;

  useEffect(() => {
    const params = new URLSearchParams({ projectId });
    if (withinDays) params.set("withinDays", withinDays);
    else params.set("all", "true");
    fetch(`/api/permits?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setPermits(data.permits ?? []))
      .finally(() => setLoading(false));
  }, [projectId, withinDays]);

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
      {loading ? (
        <p className="px-4 py-6 text-[13px] text-ct-muted">Loading…</p>
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
    </ScreenFrame>
  );
}
