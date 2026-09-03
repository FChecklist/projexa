"use client";

// Real-screen conversion (2026-08-30): roster entries never had a detail
// view or any way to edit/deactivate a worker short of re-creating them --
// updateRosterEntry() didn't exist in construction-labour-service.ts at all
// before this conversion.
//
// R67 D-33 (audit R-093). Three real defects on this page:
//
//  1. THE DESTRUCTIVE WORD WAS WRONG. The kit's ObjectScreen hard-codes
//     "Delete" on its destructive action, and this page used it for an
//     action that sets isActive=false and keeps every attendance row and
//     every cost. A foreman reading "Delete" reasonably believes the
//     worker's recorded history goes with him. The kit source is not on this
//     machine, so per programme decision D-09 ObjectScreen is FORKED into
//     src/components/screens/KitObjectScreen.tsx with a deleteLabel prop;
//     every other kit screens export is still imported from the kit.
//  2. DEACTIVATION WAS ONE-WAY. Nothing in the UI could set isActive back to
//     true, even though the route has always accepted it. An inactive worker
//     now gets Reactivate.
//  3. DISPLAY MODE SHOWED ALMOST NOTHING -- four facets and an empty body.
//     It now carries a read-only Details section and the worker's own
//     attendance history, which is the question this page exists to answer
//     ("how many days has he worked, and what has he cost?").
//
// The confirm before deactivating is INLINE, not a dialog: this product's one
// remaining popup is the home's Create Project, and a blast-radius statement
// is exactly the kind of thing that must stay readable while the user decides.
//
// ---------------------------------------------------------------------------
// R67 D-33 x D-34 MERGE (lane D3 x lane D21, decision D-11). Both lanes rebuilt
// this screen for different halves of it, and BOTH halves are kept:
//
//   D21 owns the FORM half and it is canonical, because it is the SHARED one.
//     The edit fields were a second, independent copy of the create form's;
//     they are now the same <RosterFields> reading the same validation model
//     (src/lib/roster-form.ts), with Trade as a picklist and a currencied Daily
//     Rate. D21's FieldMessage strip also replaces D3's sonner toasts for save
//     and status outcomes -- one receipt mechanism per screen, and the strip is
//     the one KitObjectScreen already renders. `toast` is gone from this file.
//   D3 owns the DISPLAY half, which the shared archetype cannot express: the
//     read-only Details section, the month-windowed attendance history with its
//     cost total, the inline blast-radius confirm, and Reactivate.
//
// TWO CONTRADICTIONS were settled on merit rather than by picking a lane:
//
//   THE DESTRUCTIVE WORD. D3 passes deleteLabel="Deactivate"; D21 left the kit
//     default and asserted the literal word "Delete". D-33/R-093 wins: the
//     action sets isActive=false and keeps every attendance row, so "Delete" is
//     factually wrong, and D21's own header already calls it "real Delete =
//     real Deactivate". D21's assertion was about the D-09 fork RENDERING both
//     controls, not about the word, so it is restated against "Deactivate".
//   AN INACTIVE WORKER'S CONTROLS. D3 hid Edit and Deactivate and showed
//     Reactivate in their place; D21 rendered them DISABLED WITH A REASON. D21's
//     is the canonical posture (decision D-22, quoted in KitObjectScreen: a
//     control that vanishes cannot be told apart from a broken feature), so
//     Edit and Deactivate now stay visible and disabled -- "This worker is
//     inactive" / "Already inactive" -- AND D3's Reactivate is offered beside
//     them. That is a superset of both lanes; D3's assertions are restated
//     against it, and they still pin what D-33 actually required: an inactive
//     worker can be neither edited nor deactivated, and can be reactivated.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// R67 F-34 (D-09) + D-22, reconciled by the integration train: the FORKED
// ObjectScreen, which carries the `loading` variant, the disabled-with-reason
// Edit/Delete, and D-33's deleteLabel/secondaryAction.
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { ObjectContext } from "@/components/shell/shell-screen-context";
import { LABOUR_OBJECT_BREADCRUMB } from "@/lib/object-breadcrumbs";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import RosterFields, { useTrades, type RosterFieldValues, type Vendor } from "@/components/RosterFields";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { useOrgMoney } from "@/lib/use-org-money";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { missingRosterFields, missingRosterReason, rosterFieldMessage, type RosterFieldKey } from "@/lib/roster-form";
import { formatDayMonthYear } from "@/lib/format-date";

import { ATTENDANCE_STATUS_LABEL, loadFailureSentence, type AttendanceStatus } from "@/lib/attendance-sheet";

type RosterEntry = { id: string; projectId: string; name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: string; isActive: boolean };
type AttendanceRow = { id: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };

// Month presets, newest first. Computed from today rather than hard-coded so
// the page is never offering a window that has not happened yet.
// R67 MERGE (D-11, lane D1 x lane D21, 2026-09-03). The label used
// `start.toLocaleString("en-US", { month: "long", timeZone: "UTC" })`, which
// D-61's lint rule bans. That call was already DETERMINISTIC -- it pinned both
// the locale and the time zone, so it was not the hydration bug the rule hunts
// -- but the rule is a syntactic ban on the method, and a per-call exception
// would be indistinguishable from the ones that are real. The month names are
// pinned as data instead, which is the pattern this repo already uses for the
// same reason (see the note above formatDayLabel in
// src/lib/design-studio-timesheet.ts). Same output, nothing to audit.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function monthPresets(today = new Date()): { label: string; from: string; to: string }[] {
  const presets: { label: string; from: string; to: string }[] = [];
  for (let back = 0; back < 6; back++) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    presets.push({
      label: `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    });
  }
  return presets;
}

const EMPTY: RosterFieldValues = { employeeCode: "", name: "", trade: "", vendorId: "", dailyRate: "" };

export default function RosterObjectClient({ rosterId, createdNotice }: { rosterId: string; createdNotice?: string | null }) {
  const router = useRouter();
  // R67 G-05 merge: the org's currency is resolved once for the screen and the
  // formatter comes back bound to it, so no cell can be rendered with the wrong
  // currency by forgetting to pass one. `money` renders the DISPLAY half (the
  // Details section and the attendance table's costs).
  const orgMoney = useOrgMoney();
  const money = orgMoney.money;
  // D21's currency LABEL is a different job from D3's money FORMATTER, so both
  // stay: `currency` is the bare prefix RosterFields and the validation
  // messages need ("AED "), and it is what the facet's "<rate> / day" reads.
  const currencies = useCurrencies();
  const currency = currencyLabel(undefined, currencies);
  const trades = useTrades();
  const [entry, setEntry] = useState<RosterEntry | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState<RosterFieldValues>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<RosterFieldKey, boolean>>>({});
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const presets = useMemo(() => monthPresets(), []);
  const [monthWindow, setMonthWindow] = useState(() => presets[0]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  // Counted over the worker's WHOLE history, not the visible month -- the
  // deactivate confirmation has to state what is really being kept.
  const [lifetimeRows, setLifetimeRows] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [data, vendorData] = await Promise.all([
        fetchJson<RosterEntry>(`/api/labour-roster/${rosterId}`),
        fetchJson<{ vendors?: Vendor[] }>("/api/vendors").catch(() => ({ vendors: [] })),
      ]);
      setEntry(data);
      setVendors(vendorData.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setEntry(null);
      setLoadError(errorMessage(err, "Couldn't load this worker"));
    }
  }, [rosterId]);
  useEffect(() => { void load(); }, [load]);

  const loadAttendance = useCallback(async () => {
    setAttendanceLoading(true);
    const [windowed, lifetime] = await Promise.allSettled([
      fetchJson<{ attendance?: AttendanceRow[] }>(
        `/api/attendance?rosterId=${encodeURIComponent(rosterId)}&from=${monthWindow.from}&to=${monthWindow.to}`
      ),
      fetchJson<{ attendance?: AttendanceRow[] }>(`/api/attendance?rosterId=${encodeURIComponent(rosterId)}`),
    ]);
    if (windowed.status === "fulfilled") {
      setAttendance(windowed.value.attendance ?? []);
      setAttendanceError(null);
    } else {
      setAttendance([]);
      setAttendanceError(loadFailureSentence(windowed.reason, "attendance for this worker"));
    }
    setLifetimeRows(lifetime.status === "fulfilled" ? (lifetime.value.attendance ?? []).length : null);
    setAttendanceLoading(false);
  }, [rosterId, monthWindow.from, monthWindow.to]);
  useEffect(() => { void loadAttendance(); }, [loadAttendance]);

  // The create screen's confirmation arrives here, in the band, because that
  // screen unmounts with the navigation.
  useEffect(() => {
    if (createdNotice) setMessages([{ level: "info", text: createdNotice }]);
  }, [createdNotice]);

  function startEdit() {
    if (!entry) return;
    setDraft({
      employeeCode: entry.employeeCode ?? "",
      name: entry.name,
      trade: entry.trade ?? "",
      vendorId: entry.vendorId ?? "",
      dailyRate: entry.dailyRate,
    });
    setTouched({});
    setMessages([]);
    setMode("edit");
  }

  function blurField(field: RosterFieldKey) {
    setTouched((t) => ({ ...t, [field]: true }));
    const message = rosterFieldMessage(field, draft, currency);
    setMessages(message ? [{ field, level: "error", text: message }] : []);
  }

  const missing = mode === "edit" ? missingRosterFields(draft) : [];

  async function saveEdit() {
    if (missing.length > 0) {
      setTouched({ name: true, dailyRate: true });
      setMessages(missing.map((field) => ({ field, level: "error" as const, text: rosterFieldMessage(field, draft, currency)! })));
      return;
    }
    setSaving(true);
    setMessages([]);
    try {
      const data = await fetchJson<RosterEntry>(`/api/labour-roster/${rosterId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          employeeCode: draft.employeeCode.trim() || null,
          trade: draft.trade.trim() || null,
          vendorId: draft.vendorId || null,
          dailyRate: Number(draft.dailyRate),
        }),
      });
      setEntry(data);
      setMode("display");
      setMessages([{ level: "info", text: "Worker saved" }]);
    } catch (err) {
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't save this worker") }]);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(isActive: boolean) {
    setStatusChanging(true);
    try {
      const data = await fetchJson<RosterEntry>(`/api/labour-roster/${rosterId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      setEntry(data);
      setConfirmingDeactivate(false);
      // D3 x D21 merge: D21's message strip (not D3's toast), but kept
      // TWO-WAY -- D-33's point 2 is that deactivation stopped being one-way,
      // so the receipt has to be able to say "reactivated" too.
      setMessages([{ level: "info", text: isActive ? "Worker reactivated" : "Worker deactivated" }]);
    } catch (err) {
      setMessages([{
        level: "error",
        text: errorMessage(err, isActive ? "Couldn't reactivate this worker" : "Couldn't deactivate this worker"),
      }]);
    } finally {
      setStatusChanging(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  // R67 F-34 (R-290) merge: the SAME frame the route's own loading.tsx paints,
  // so the hand-over from the route skeleton to this client is invisible and
  // the word "Loading" is never alone on the screen. It says what it is waiting
  // for after 3 s and offers Retry at 8 s, D-04's abort budget. What it
  // replaced was a bare paragraph whose entire content was the word "Loading",
  // which is the exact shape object-breadcrumbs.test.ts scans this file for --
  // so the old markup is described here rather than quoted.
  if (!entry)
    return (
      <KitObjectScreen
        loading
        breadcrumb={LABOUR_OBJECT_BREADCRUMB.breadcrumb}
        label={LABOUR_OBJECT_BREADCRUMB.label}
        actions={LABOUR_OBJECT_BREADCRUMB.actions}
      />
    );

  // D21's "Direct hire" over D3's em-dash, on merit: a worker with no
  // subcontractor is not missing data, he is directly employed, and the em-dash
  // said "unknown" about a fact the record actually knows.
  const vendorName = vendors.find((v) => v.id === entry.vendorId)?.vendorName ?? "Direct hire";
  const windowCost = attendance.reduce((sum, row) => sum + Number(row.dailyCost || 0), 0);
  const keptRows = lifetimeRows ?? attendance.length;

  return (
    <>
    {/* R67 A-21: the composer's strip names this worker and their project --
        "<project> › Worker Ramesh Kumar" -- instead of the module. Published
        after the fetch, which is when this page first knows either. */}
    <ObjectContext moduleId="labour" label={entry.name} projectId={entry.projectId} />
    {/* R67 D-33 / decision D-09: the KIT's ObjectScreen cannot say
        "Deactivate" -- its delete control is hard-coded to "Delete", which is
        the wrong word for a reversible status change that keeps every row.
        KitObjectScreen is the fork that adds deleteLabel and a display-mode
        secondaryAction, and nothing else. */}
    <KitObjectScreen
      breadcrumb={LABOUR_OBJECT_BREADCRUMB.breadcrumb}
      title={mode === "edit" ? "Edit Worker" : entry.name}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: entry.isActive ? "done" : "late", label: entry.isActive ? "active" : "inactive" }}
      facets={[
        { label: "ID", value: entry.employeeCode ?? "—" },
        { label: "Trade", value: entry.trade ?? "—" },
        { label: "Company", value: vendorName },
        // D21's facet: the rate with its currency AND its unit. "AED 300"
        // alone does not say per what, and this roster is priced per day.
        { label: "Daily Rate", value: `${currency}${entry.dailyRate} / day` },
      ]}
      // Edit is RENDERED on an inactive worker, disabled with its reason,
      // rather than vanishing (D-22 / D21). D3's earlier version hid it, which
      // is the exact posture D-22 exists to stop.
      onEdit={entry.isActive && mode === "display" ? startEdit : undefined}
      editDisabledReason={mode === "display" && !entry.isActive ? "This worker is inactive" : undefined}
      // D-33 point 2: deactivation is no longer one-way. Reactivate sits beside
      // the disabled Edit rather than replacing it.
      secondaryAction={
        !entry.isActive && mode === "display"
          ? { label: "Reactivate", onClick: () => void setActive(true), disabledReason: statusChanging ? "Working…" : undefined }
          : undefined
      }
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => { setMode("display"); setMessages([]); } : undefined}
      // D3's INLINE CONFIRM is kept: this opens the blast-radius statement, it
      // does not PATCH. (D21 wired onDelete straight to a `deactivate` function
      // that does not exist in the merged file -- the confirm flow is the one
      // that is actually implemented, and it is also the safer of the two.)
      onDelete={entry.isActive && mode === "display" ? () => setConfirmingDeactivate(true) : undefined}
      // D-33 / R-093: the word. This sets isActive=false and keeps every
      // attendance row, so it cannot say "Delete".
      deleteLabel="Deactivate"
      // Rendered-with-a-reason rather than absent (the D-09 fork's whole
      // point): on an already-inactive worker the control stays visible and
      // says why it is not offered.
      deleteDisabledReason={statusChanging ? "Working…" : !entry.isActive ? "Already inactive" : mode === "edit" ? "Finish editing first" : undefined}
      onBack={() => router.push(`/labour?projectId=${entry.projectId}`)}
      saveDisabled={saving || missing.length > 0}
      saveDisabledReason={saving ? "Saving…" : missingRosterReason(draft)}
      messages={messages}
    >
      {mode === "edit" && (
        <RosterFields
          values={draft}
          onChange={(field, value) => {
            setDraft((d) => ({ ...d, [field]: value }));
            setMessages([]);
          }}
          vendors={vendors}
          trades={trades}
          currency={currency}
          touched={touched}
          onBlurField={blurField}
        />
      )}

      {mode === "display" && (
        <>
          {confirmingDeactivate && (
            // The blast radius, stated before the PATCH rather than after it.
            //
            // DECLARED DEVIATION from D-33's quoted string, which reads
            // "...He will no longer appear in Mark Attendance. His 37
            // attendance rows...". The name is dynamic and this roster carries
            // Ali Hassan and Bina Rao alike, so the pronoun cannot be derived
            // from it; "They/Their" is used instead. Everything else in the
            // sentence -- the name, the count, the two facts it states -- is
            // verbatim. Recorded here and in the PR body rather than left as a
            // silent divergence from an item's quoted copy.
            <div role="alertdialog" aria-label="Confirm deactivation" className="border-t border-ct-border bg-px-error-light px-4 py-3">
              <p className="text-[13px] text-px-error">
                Deactivate {entry.name}? They will no longer appear in Mark Attendance. Their {keptRows} attendance {keptRows === 1 ? "row" : "rows"} and costs are kept.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="destructive" disabled={statusChanging} onClick={() => void setActive(false)}>
                  {statusChanging ? "Deactivating…" : "Deactivate"}
                </Button>
                <Button size="sm" variant="outline" disabled={statusChanging} onClick={() => setConfirmingDeactivate(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* OBSERVED BY THE D3 x D21 MERGE, deliberately NOT resolved here.
              This Details block repeats the four facets above it (ID, Trade,
              Company, Daily Rate) and adds only Status, which the header badge
              already shows. D-33 asked for it when display mode was four facets
              and an EMPTY body; D21's facet strip and D3's attendance history
              have both landed since, so the redundancy is real. Collapsing it is
              a product call about D-33's own acceptance criterion ("a read-only
              Details block names ID, Trade, Company, Daily Rate and Status"),
              not a merge call, so it is named here and left standing rather than
              dropped by an integration agent. */}
          <section className="border-t border-ct-border px-4 py-3">
            <h2 className="mb-2 text-[13px] font-medium text-ct-slate">Details</h2>
            <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {[
                { label: "ID", value: entry.employeeCode ?? "—" },
                { label: "Trade", value: entry.trade ?? "—" },
                { label: "Company", value: vendorName },
                { label: "Daily Rate", value: money(entry.dailyRate) },
                { label: "Status", value: entry.isActive ? "Active" : "Inactive" },
              ].map((field) => (
                <div key={field.label} className="text-[12.5px]">
                  <dt className="inline text-ct-muted">{field.label}: </dt>
                  <dd className="inline font-medium text-ct-navy">{field.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="border-t border-ct-border px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13px] font-medium text-ct-slate">Attendance</h2>
              <select
                aria-label="Attendance month"
                className="h-8 rounded-md border border-ct-border2 bg-background px-2 text-[13px]"
                value={monthWindow.from}
                onChange={(event) => setMonthWindow(presets.find((p) => p.from === event.target.value) ?? presets[0])}
              >
                {presets.map((preset) => <option key={preset.from} value={preset.from}>{preset.label}</option>)}
              </select>
            </div>

            {attendanceLoading ? (
              <p className="py-4 text-[13px] text-ct-muted" role="status">Loading attendance…</p>
            ) : attendanceError ? (
              <div className="space-y-2 py-2">
                <p role="alert" className="text-[13px] text-px-error">{attendanceError}</p>
                <Button size="sm" variant="outline" onClick={() => void loadAttendance()}>Retry</Button>
              </div>
            ) : attendance.length === 0 ? (
              <p className="py-4 text-[13px] text-ct-muted">No attendance recorded for this worker yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendance.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatDayMonthYear(row.attendanceDate)}</TableCell>
                      <TableCell>{ATTENDANCE_STATUS_LABEL[row.status as AttendanceStatus] ?? row.status}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.hoursWorked ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.dailyCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="font-semibold">Total cost</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(windowCost)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </section>
        </>
      )}
    </KitObjectScreen>
    </>
  );
}
