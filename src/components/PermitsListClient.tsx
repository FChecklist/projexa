"use client";

// R42 seq21/22: registry-driven replacement for PermitsClient.tsx (190
// lines, 21 Dialog refs, zero back/next/cancel/save/draft -- per
// screen_spec's own PERMITS.LIST row). Renders from the kit's ListScreen
// against real /api/permits data. Kept thin per GLOBAL's own rule ("route
// files must stay THIN, ~40 lines -- if one grows past that, something
// module-specific is leaking into projexa that belongs in the kit or the
// registry"); the real column/importance decisions live in the
// screen_definitions row (permits.list) this reads structurally, not here.
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

export default function PermitsListClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/permits?projectId=${encodeURIComponent(projectId)}&all=true`)
      .then((r) => r.json())
      .then((data) => setPermits(data.permits ?? []))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <ScreenFrame
      breadcrumb="Permits"
      newAction={{ label: "+ New", onClick: () => router.push(`/permits/new?projectId=${projectId}`) }}
      exportAction={{ label: "Export" }}
      filterAction={{ label: "Filter" }}
      messages={[]}
    >
      {loading ? (
        <p className="px-4 py-6 text-[13px] text-ct-muted">Loading…</p>
      ) : (
        <ListScreen
          functionId="permits.list"
          columns={COLUMNS}
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
