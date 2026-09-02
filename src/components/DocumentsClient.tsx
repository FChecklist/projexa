"use client";

// R46 P8 seq128: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list and R46 P8 seq134 established for
// variations.list (see PermitsListClient.tsx's and ChangeOrdersClient.tsx's
// header comments for the full history). This screen never adopted the
// kit's ListScreen component -- it's a plain shadcn Table with its own
// category filter (kept exactly as-is, outside the registry-driven table)
// -- so only the 6 real data columns (Name/Category/Type/Size/Expiry/Added)
// are registry-driven: COLUMNS is now the fallback used when
// documents/page.tsx's server-side resolve of the documents.list
// screen_definitions row returns null (404/error), same "keep the
// hardcoded version behind a flag until verified" contract as permits and
// change-orders.
//
// R67 D-13 (audit R-037/R-038/R-042/R-043). What was wrong: the catch showed a
// toast and then fell through to the SAME branch the empty case renders, so a
// 500 or a 504 from VERIDIAN produced the sentence "No documents found for this
// project." -- a definite claim about the user's data made from a read that
// failed (the standing rule in src/lib/read-outcome.ts). The toast that carried
// the real reason was gone in four seconds; the false claim stayed on screen.
//
// There are now exactly FOUR branches and they are mutually exclusive: loading,
// loadError, zero rows, filtered zero rows. The empty-state wording can no
// longer appear over a failed GET, because loadError is checked first and the
// rows are cleared when it is set.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FileText, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { slowLoadNotice, useElapsedMs } from "@/lib/slow-load";
import DataLoadError from "@/components/DataLoadError";

type Doc = {
  id: string;
  name: string;
  category: string;
  fileType: string | null;
  fileSize: number | null;
  expiryDate: string | null;
  versionNumber: number;
  createdAt: string;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Category", field: "category", type: "text", importance: "High" },
  { label: "Type", field: "fileType", type: "text", importance: "High" },
  { label: "Size", field: "fileSize", type: "number", importance: "High" },
  { label: "Expiry", field: "expiryDate", type: "date", importance: "High" },
  { label: "Added", field: "createdAt", type: "date", importance: "High" },
];

const CATEGORIES = ["all", "permit", "drawing", "contract", "certificate", "license", "site_photo", "other"];

/** "site photo" -- what a category reads as in a sentence. */
export function categoryWords(category: string): string {
  return category.replace(/_/g, " ");
}

/**
 * R67 D-13. The two empty states, which differ because they mean different
 * things: "you have not filed anything here yet" and "a filter is holding your
 * documents back". Neither is reachable over a failed read -- see the branch
 * order in the component below.
 */
export function emptyStateText(category: string, scopeName: string): string {
  return category === "all"
    ? `No documents yet for ${scopeName}.`
    : `No ${categoryWords(category)} documents for ${scopeName}.`;
}

/**
 * R67 D-13. The backend's own words, verbatim, prefixed by what the user was
 * trying to do -- so veridian-client's "did not respond in time, on two
 * attempts" is recognisable across every screen that shows it. The full stop is
 * added only when the message does not already end in punctuation, so a message
 * that ends "Please retry." never renders "Please retry..".
 */
export function documentsLoadErrorText(err: unknown): string {
  const message = errorMessage(err, "Could not load documents");
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike PermitsListClient there's no generic
// column-type-driven renderer to hand columns to. A registry row can still
// reorder/relabel these 6 columns live (the hard-stop test); the actual
// cell value for each known field is still this project's own formatting
// logic, looked up by field name so reordering doesn't change what renders.
function renderDocumentCell(field: string, d: Doc) {
  switch (field) {
    case "name":
      return (
        <span className="flex items-center gap-2 font-medium">
          <FileText className="size-4 text-px-muted" />{d.name}
        </span>
      );
    case "category":
      return <Badge variant="outline">{categoryWords(d.category)}</Badge>;
    case "fileType":
      return <span className="text-px-muted">{d.fileType ?? "—"}</span>;
    case "fileSize":
      return <span className="text-px-muted">{formatSize(d.fileSize)}</span>;
    case "expiryDate":
      return <span className="text-px-muted">{d.expiryDate ? formatDate(d.expiryDate) : "—"}</span>;
    case "createdAt":
      return <span className="text-px-muted">{formatDate(d.createdAt)}</span>;
    default:
      return String((d as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function DocumentsClient({
  projectId,
  projectName,
  fellBack,
  projects,
  registryColumns,
}: {
  projectId: string;
  /**
   * R67 D-13: the screen names the project it queried. Resolved server-side in
   * documents/page.tsx, which already had the project in hand and was throwing
   * away everything but its id.
   */
  projectName?: string;
  /** True when no ?projectId was asked for and the org's first project was used. */
  fellBack?: boolean;
  /** For the "Change project" switcher shown when the page fell back. */
  projects?: { id: string; name: string }[];
  registryColumns?: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [switching, setSwitching] = useState(false);
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const scopeName = projectName ?? "this project";

  // "Still loading documents from VERIDIAN…" once the read has been running for
  // 3 s -- D-04's budget. A read that is merely slow is not an error, but a
  // screen that says nothing for twenty seconds is not honest either.
  const elapsedMs = useElapsedMs(loading);
  const slowNotice = loading ? slowLoadNotice("Still loading documents from VERIDIAN…", elapsedMs) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ linkedEntityType: "project", linkedEntityId: projectId });
      if (category !== "all") params.set("category", category);
      const data = await fetchJson<{ documents?: Doc[] }>(`/api/documents?${params.toString()}`);
      setDocs(data.documents ?? []);
      setLoadError(null);
    } catch (err) {
      // Never an empty table where an error belongs: the rows are cleared AND
      // the table is withheld, so "there are none" and "we could not find out"
      // cannot look identical. No toast -- the reason must persist until it is
      // resolved or retried.
      setDocs([]);
      setLoadError(documentsLoadErrorText(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, category]);

  useEffect(() => { void load(); }, [load]);

  const filtered = category !== "all";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">
          Documents linked directly to this project (permits, drawings, site photos, etc.). Records attached to a
          specific RFI, work progress entry, or other item are visible from that record.
        </p>
        <div className="flex items-center gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c === "all" ? "All categories" : categoryWords(c)}</SelectItem>)}</SelectContent>
          </Select>
          {/* Real screen navigation (2026-08-30) -- replaces the old
              "Upload Document" Dialog popup with a real create route. */}
          <Button size="sm" onClick={() => router.push(`/documents/upload?projectId=${projectId}`)}><Plus className="size-4" /> Upload</Button>
        </div>
      </div>

      {/* R67 D-13: when the page fell back to the org's first project, the
          screen says so and offers a real way to change it, rather than showing
          one project's documents under a rail that still reads "All projects". */}
      {fellBack && projectName && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-[12.5px] text-px-muted">
            Showing {projectName} (first project). Choose a project in the top rail to switch.
          </p>
          {projects && projects.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setSwitching((open) => !open)}
                className="text-[12.5px] underline underline-offset-2 text-px-muted hover:text-ct-navy"
              >
                Change project
              </button>
              {switching && (
                <select
                  aria-label="Project"
                  value={projectId}
                  onChange={(e) => router.push(`/documents?projectId=${e.target.value}`)}
                  className="rounded-md border border-ct-border2 px-2 py-1 text-[12.5px]"
                >
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </>
          )}
        </div>
      )}

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            // Branch 1 -- LOADING. A skeleton carrying the REAL column headers,
            // so the shape of what is coming is already on screen and nothing
            // moves under the reader's cursor when the rows arrive.
            <div aria-busy="true">
              <Table>
                <TableHeader>
                  <TableRow>{columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  {[0, 1, 2].map((row) => (
                    <TableRow key={row}>
                      {columns.map((col) => (
                        <TableCell key={col.field}>
                          <span className="block h-3.5 w-24 animate-pulse rounded bg-px-cloud" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {slowNotice && <p className="px-4 pb-4 text-[12.5px] text-px-muted">{slowNotice}</p>}
            </div>
          ) : loadError ? (
            // Branch 2 -- ERROR. The backend's own words, and a Retry that is
            // ignored while a request is already in flight.
            <div role="alert" className="space-y-2 rounded-md border border-px-error-border bg-px-error-light p-4 text-sm text-px-error">
              <p>{loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="underline underline-offset-2 disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          ) : docs.length === 0 ? (
            // Branches 3 and 4 -- EMPTY, reachable only after a read that
            // SUCCEEDED, and worded differently depending on whether a filter is
            // holding rows back.
            <p className="py-10 text-center text-sm text-px-muted">
              {emptyStateText(category, scopeName)}{" "}
              {filtered ? (
                <button
                  type="button"
                  onClick={() => setCategory("all")}
                  className="underline underline-offset-2 hover:text-ct-navy"
                >
                  Clear filter
                </button>
              ) : (
                <Link href={`/documents/upload?projectId=${projectId}`} className="underline underline-offset-2 hover:text-ct-navy">
                  + New Document
                </Link>
              )}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  // Real screen navigation (2026-08-30) -- rows now open the
                  // real Object Page instead of nothing (no way to view/
                  // download an uploaded file again existed before this).
                  <TableRow key={d.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/documents/${d.id}`)}>
                    {columns.map((col) => (
                      <TableCell key={col.field}>{renderDocumentCell(col.field, d)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* The persistent message band this route will have once ScreenFrame is
          adopted here. Until then it is DataLoadError under the card, carrying
          the same backend text and the same Retry, with the error count beside
          it -- so the reason survives after the reader scrolls past the table. */}
      {loadError && (
        <div className="space-y-1.5">
          <p className="text-[12.5px] text-px-error">1 error</p>
          <DataLoadError messages={[loadError]} onRetry={() => void load()} />
        </div>
      )}
    </div>
  );
}
