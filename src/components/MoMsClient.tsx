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
// R67 lane D22 (item D-58, rec R-187): every row carries its own Open, Export
// PDF and Share actions. Before this, the only way to send a client the
// minutes of last Tuesday's meeting was to open it first -- so the list, which
// is where someone actually looks for "that meeting", could do nothing with
// one. Status is a glyph PLUS the word (never colour alone).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CheckCircle2, CircleDashed, Loader2, NotebookText, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDateTime } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import ShareSheet, { type ShareLinkResult } from "@/components/ShareSheet";

type Meeting = {
  id: string;
  title: string;
  status: string;
  scheduledAt: string;
  minutes: string | null;
  aiSummary: string | null;
};

async function createShareLinkFor(meetingId: string): Promise<ShareLinkResult> {
  const res = await fetch(`/api/moms/${meetingId}/share-links`, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.shareUrl) throw new Error(data?.error ?? "Couldn't create a share link");
  return { shareUrl: data.shareUrl as string, whatsappHref: data.whatsappHref as string };
}

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / DocumentsClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "Meeting", field: "title", type: "text", importance: "High" },
  { label: "Date", field: "scheduledAt", type: "date", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
];

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
      // Glyph + the word, never colour alone -- a published MoM is locked, and
      // that is exactly the fact a reader must be able to see at a glance.
      return m.status === "published" ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-px-success">
          <CheckCircle2 className="size-3.5" aria-hidden="true" /> published
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-px-muted">
          <CircleDashed className="size-3.5" aria-hidden="true" /> draft
        </span>
      );
    default:
      return String((m as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function MoMsClient({ projectId, registryColumns }: { projectId: string; registryColumns?: RegistryColumn[] | null }) {
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson<{ meetings?: Meeting[] }>(`/api/moms?projectId=${encodeURIComponent(projectId)}`);
      setMeetings(data.meetings ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load meeting minutes"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">Minutes of Meeting for this project — live notes, AI summary, PDF export.</p>
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Meeting" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push(`/moms/new?projectId=${projectId}`)}><Plus className="size-4" /> New Meeting</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : meetings.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No meetings recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                  <TableHead className="text-right">Actions</TableHead>
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
                    {/* The row is still the primary way in (clicking anywhere
                        opens the meeting); these are the two things people
                        want to do WITHOUT opening it. stopPropagation so a
                        Share click never also navigates away from the sheet
                        it just opened. */}
                    <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => router.push(`/moms/${m.id}`)}>Open</Button>
                      <ShareSheet
                        variant="menu"
                        pdfHref={`/api/moms/${m.id}/pdf`}
                        createShareLink={() => createShareLinkFor(m.id)}
                        shareDisabledReason={m.status === "published" ? null : "Publish the meeting first"}
                        onMessage={(msg) => (msg.level === "error" ? toast.error(msg.text) : toast.success(msg.text))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
