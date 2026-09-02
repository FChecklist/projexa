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
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, type FieldMessage, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { StatusPillTone } from "@/components/ui/status-pill";
import {
  parseWithinDays,
  permitHeaderParts,
  permitStatus,
  permitStatusCounts,
  sortByExpiryAscending,
} from "@/components/permit-status";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { takeScreenMessage } from "@/lib/screen-message";

type Permit = {
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
  // read here so this column is correct before and after that lands.
  hasDocument?: boolean;
  documentUrl?: string | null;
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// intentionally the same fields as ScreenColumn so a registry row can be
// passed straight to ListScreen with no reshaping.
export type RegistryColumn = ScreenColumn;

// R67 D-05: one word set across the list, the create form, the object page
// and the API -- "Permit name", "Permit number", "Issuing authority",
// "Issue date", "End date", "Days left". "Expiry date" here vs "End date" on
// the object page was the same field under two names on two screens of the
// same module. (The registry row is the other half of this rename and is
// C01-22's, because page.tsx prefers registry columns over this constant.)
const COLUMNS: ScreenColumn[] = [
  { label: "Permit number", field: "permitNumber", type: "text", importance: "High" },
  { label: "Permit name", field: "name", type: "text", importance: "High" },
  { label: "Issuing authority", field: "permitAuthority", type: "text", importance: "High" },
  { label: "Issue date", field: "issueDate", type: "date", importance: "High" },
  { label: "End date", field: "endDate", type: "date", importance: "High" },
  // R67 G-01 (merged before this lane, and it wins here): the sixth column was
  // "Days left", which promises a number, and D-05's own word list said the
  // same. G-01 replaced the bare signed number with a sentence the cell can
  // actually answer ("expired 3 days ago" / "expires in 12 days"), so the
  // header asks a question instead of naming a unit. D-05's other five words
  // stand unchanged, including the "Expiry date" -> "End date" rename above,
  // which is the one this module was really inconsistent about.
  { label: "Status", field: "daysToExpiry", type: "text", importance: "High" },
];

// R67 D-05: affordance columns, appended to whichever column set is in force
// (registry row or the fallback above) because they are not data the registry
// describes -- they are how a row says what it can do. Deliberately NOT
// importance "High": ListScreen caps High columns at 7 and silently drops the
// overflow, which would make these two vanish exactly when the registry row
// is fully populated.
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
  fellBack,
  withinDays,
  registryColumns,
}: {
  projectId: string;
  /** R67 D-07: the project this list actually queried, so the screen can name it. */
  projectName?: string;
  /** R67 D-07: true when no project was asked for and the first one was used. */
  fellBack?: boolean;
  withinDays?: string;
  registryColumns?: RegistryColumn[] | null;
}) {
  const router = useRouter();
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const base = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const columns = [
    ...base,
    ...(base.some((c) => c.field === DOCUMENT_COLUMN.field) ? [] : [DOCUMENT_COLUMN]),
    ...(base.some((c) => c.field === OPEN_COLUMN.field) ? [] : [OPEN_COLUMN]),
  ];

  // R67 D-05: the receipt handed over by a delete on the object page. It is a
  // persistent message in this screen's own band, not a toast, and it is read
  // once (see screen-message.ts).
  useEffect(() => {
    const handed = takeScreenMessage("permits.list");
    if (handed) setMessages([handed]);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ projectId });
    if (withinDays) params.set("withinDays", withinDays);
    else params.set("all", "true");
    fetch(`/api/permits?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setPermits(data.permits ?? []))
      .finally(() => setLoading(false));
  }, [projectId, withinDays]);

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

  // The signed URL is short-lived, so it is fetched at the moment of the
  // click rather than held in the list. The blank tab is opened FIRST,
  // synchronously, because a window.open() after an await is a popup a
  // browser blocks.
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

  return (
    <ScreenFrame
      breadcrumb="Permits"
      // R67 D-07: the frame draws the plus glyph itself, so a label of
      // "+ New" rendered as "+ + New" on every list screen.
      newAction={{ label: "New", onClick: () => router.push(`/permits/new?projectId=${projectId}`) }}
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
      // R67 D-05: the receipt handed over by a delete on the object page.
      messages={messages}
    >
      {/* R67 D-07: when the page fell back to the org's first project, the
          screen says which project it is showing instead of leaving the rail
          claiming "All projects" over one project's rows. */}
      {fellBack && projectName && (
        <p role="status" className="px-4 pt-3 text-[12.5px] text-ct-muted">
          Showing {projectName} (first project). Choose a project in the top rail to switch.
        </p>
      )}
      {loading ? (
        <p className="px-4 py-6 text-[13px] text-ct-muted">Loading…</p>
      ) : (
        <ListScreen
          functionId="permits.list"
          columns={columns}
          rows={rows as unknown as Record<string, unknown>[]}
          getRowId={(row) => row.id as string}
          onRowClick={(row) => router.push(`/permits/${row.id}`)}
          emptyStateLabel={projectName ? `No permits yet for ${projectName}.` : "No permits yet for this project."}
          renderCell={{
            daysToExpiry: (row) => {
              const status = permitStatus((row as unknown as Permit).daysToExpiry, windowDays);
              return <StatusPillTone tone={status.tone} label={status.label} />;
            },
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
          }}
        />
      )}
    </ScreenFrame>
  );
}
