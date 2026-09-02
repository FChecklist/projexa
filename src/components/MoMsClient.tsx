"use client";

// Wave 143 (Minutes of Meeting module): live meeting-notes creation, AI
// summary generation, and PDF export -- wired to VERI Meeting Intelligence
// (veri-meeting-service.ts) via /api/moms, not PROJEXA's basic scheduling
// CRUD (/api/meetings).
//
// R46 P8 seq129: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list (see PermitsListClient.tsx's header comment
// for the full history) and R46 P8 seq134 established for
// variations.list/ChangeOrdersClient.tsx. This screen never adopted the
// kit's ListScreen component -- it's a plain shadcn Table -- so only the 3
// real data columns (Meeting/Date/Status) are registry-driven: COLUMNS is
// now the fallback used when moms/page.tsx's server-side resolve of the
// moms.list screen_definitions row returns null (404/error), same
// "keep the hardcoded version behind a flag until verified" contract as
// permits/change-orders/documents.
//
// Real-screen conversion (2026-08-30): "New Meeting" routes to a real
// create screen (MoMCreateClient.tsx); rows route to a real Object Page
// (MoMObjectClient.tsx) instead of toggling an inline "selected" panel held
// only in local state. Every action this list used to expose inline
// (Minutes/PDF/WhatsApp) now lives on that Object Page, which also gained
// real Edit/Publish/Action-Items/Share-link-management -- see that
// component's own header comment for the full list of previously-hidden
// backend capability this closes.
//
// R67 F-18: the meetings now normally arrive as props, fetched by
// moms/page.tsx on the server inside its Suspense boundary, so this list
// paints filled on first render. useModuleList keeps the client fetch for a
// project switch and gives it an AbortController; a failed read is now shown
// as the backend's own words in place of the table, never as an empty one.
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotebookText, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDateTime } from "@/lib/format-date";
import { MOMS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { useModuleList, type ModuleListInitial } from "@/lib/use-module-list";
import { AsOfStamp } from "@/components/AsOfStamp";
import ListScreenFrame from "@/components/ListScreenFrame";

// Exported so moms/page.tsx can type the rows it fetches server-side.
export type Meeting = {
  id: string;
  title: string;
  status: string;
  scheduledAt: string;
  minutes: string | null;
  aiSummary: string | null;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / DocumentsClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

// R67 F-18: the fallback labels moved to src/lib/module-list-columns.ts so
// this screen's loading skeleton draws the same column heads this table does.

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike PermitsListClient there's no generic
// column-type-driven renderer to hand columns to. A registry row can still
// reorder/relabel these 3 columns live (the hard-stop test); the actual
// cell value for each known field is still this project's own formatting
// logic, looked up by field name so reordering doesn't change what renders.
function renderMeetingCell(field: string, m: Meeting) {
  switch (field) {
    case "title":
      return (
        <span className="flex items-center gap-2 font-medium">
          <NotebookText className="size-4 text-px-muted" />{m.title}
        </span>
      );
    case "scheduledAt":
      return <span className="text-px-muted">{formatDateTime(m.scheduledAt)}</span>;
    case "status":
      return <Badge variant={m.status === "published" ? "default" : "outline"}>{m.status}</Badge>;
    default:
      return String((m as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function MoMsClient({
  projectId,
  registryColumns,
  initial = null,
}: {
  projectId: string;
  registryColumns?: RegistryColumn[] | null;
  initial?: ModuleListInitial<Meeting>;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MOMS_LIST_COLUMNS;

  const { rows: meetings, error, loading, asOf, reload } = useModuleList<Meeting>({
    initial,
    url: `/api/moms?projectId=${encodeURIComponent(projectId)}`,
    pick: (d) => d.meetings as Meeting[] | undefined,
    context: "meeting minutes",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">
          Minutes of Meeting for this project — live notes, AI summary, PDF export. <AsOfStamp at={asOf} />
        </p>
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Meeting" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push(`/moms/new?projectId=${projectId}`)}><Plus className="size-4" /> New Meeting</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {/* R67 F-31: data-state / aria-busy on the list region, and after 3 s
              the wait says "Still loading minutes… <n> s" instead of spinning
              in silence. */}
          <ListScreenFrame label="minutes" loading={loading} error={error} rowCount={meetings.length} onRetry={reload}>
          {error ? (
            // Never an empty table over a failed read -- the user must be able
            // to tell "no meetings" from "we could not find out".
            <p role="alert" className="py-10 text-center text-sm text-px-error">{error}</p>
          ) : meetings.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No meetings recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the real
                    Object Page, where Minutes/PDF/WhatsApp/Publish/Action
                    Items now all live. */}
                {meetings.map((m) => (
                  <TableRow key={m.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/moms/${m.id}`)}>
                    {columns.map((col) => (
                      <TableCell key={col.field}>{renderMeetingCell(col.field, m)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          </ListScreenFrame>
        </CardContent>
      </Card>
    </div>
  );
}
