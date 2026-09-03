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
//     src/components/screens/ObjectScreen.tsx with a deleteLabel prop; every
//     other kit screens export is still imported from the kit.
//  2. DEACTIVATION WAS ONE-WAY. Nothing in the UI could set isActive back to
//     true, even though the route has always accepted it. An inactive worker
//     now gets Reactivate where Edit would be.
//  3. DISPLAY MODE SHOWED ALMOST NOTHING -- four facets and an empty body.
//     It now carries a read-only Details section and the worker's own
//     attendance history, which is the question this page exists to answer
//     ("how many days has he worked, and what has he cost?").
//
// The confirm before deactivating is INLINE, not a dialog: this product's one
// remaining popup is the home's Create Project, and a blast-radius statement
// is exactly the kind of thing that must stay readable while the user decides.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import { ObjectContext } from "@/components/shell/shell-screen-context";
import { LABOUR_OBJECT_BREADCRUMB } from "@/lib/object-breadcrumbs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrgMoney } from "@/lib/use-org-money";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDayMonthYear } from "@/lib/format-date";

import { ATTENDANCE_STATUS_LABEL, loadFailureSentence, type AttendanceStatus } from "@/lib/attendance-sheet";

type RosterEntry = { id: string; projectId: string; name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: string; isActive: boolean };
type Vendor = { id: string; vendorName: string };
type AttendanceRow = { id: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };

// Month presets, newest first. Computed from today rather than hard-coded so
// the page is never offering a window that has not happened yet.
function monthPresets(today = new Date()): { label: string; from: string; to: string }[] {
  const presets: { label: string; from: string; to: string }[] = [];
  for (let back = 0; back < 6; back++) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    presets.push({
      label: `${start.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${start.getUTCFullYear()}`,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    });
  }
  return presets;
}

export default function RosterObjectClient({ rosterId }: { rosterId: string }) {
  const router = useRouter();
  // R67 G-05 merge: the org's currency is resolved once for the screen and the
  // formatter comes back bound to it, so no cell can be rendered with the wrong
  // currency by forgetting to pass one.
  const orgMoney = useOrgMoney();
  const money = orgMoney.money;
  const [entry, setEntry] = useState<RosterEntry | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ name: "", employeeCode: "", trade: "", skillLevel: "", vendorId: "", dailyRate: "" });
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

  function startEdit() {
    if (!entry) return;
    setDraft({ name: entry.name, employeeCode: entry.employeeCode ?? "", trade: entry.trade ?? "", skillLevel: entry.skillLevel ?? "", vendorId: entry.vendorId ?? "", dailyRate: entry.dailyRate });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.name.trim() || !draft.dailyRate) { toast.error("Name and daily rate are required"); return; }
    setSaving(true);
    try {
      const data = await fetchJson<RosterEntry>(`/api/labour-roster/${rosterId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(), employeeCode: draft.employeeCode || null, trade: draft.trade || null,
          skillLevel: draft.skillLevel || null, vendorId: draft.vendorId || null, dailyRate: Number(draft.dailyRate),
        }),
      });
      toast.success("Worker saved");
      setMode("display");
      setEntry(data);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save worker"));
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
      toast.success(isActive ? "Worker reactivated" : "Worker deactivated");
      setEntry(data);
      setConfirmingDeactivate(false);
    } catch (err) {
      toast.error(errorMessage(err, isActive ? "Couldn't reactivate worker" : "Couldn't deactivate worker"));
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

  const vendorName = vendors.find((v) => v.id === entry.vendorId)?.vendorName ?? "—";
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
        { label: "Daily Rate", value: money(entry.dailyRate) },
      ]}
      onEdit={entry.isActive && mode === "display" ? startEdit : undefined}
      // Deactivation is no longer one-way: an inactive worker gets Reactivate
      // where Edit would be.
      secondaryAction={
        !entry.isActive && mode === "display"
          ? { label: "Reactivate", onClick: () => void setActive(true), disabledReason: statusChanging ? "Working…" : undefined }
          : undefined
      }
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onDelete={entry.isActive && mode === "display" ? () => setConfirmingDeactivate(true) : undefined}
      deleteLabel="Deactivate"
      deleteDisabledReason={statusChanging ? "Working…" : undefined}
      onBack={() => router.push(`/labour?projectId=${entry.projectId}`)}
      saveDisabled={saving || !draft.name.trim() || !draft.dailyRate}
      saveDisabledReason={saving ? "Saving…" : !draft.name.trim() || !draft.dailyRate ? "Name and daily rate are required" : undefined}
      messages={[]}
    >
      {mode === "edit" && (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5"><Label>ID (optional)</Label><Input value={draft.employeeCode} onChange={(e) => setDraft((d) => ({ ...d, employeeCode: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={draft.trade} onChange={(e) => setDraft((d) => ({ ...d, trade: e.target.value }))} /></div>
          <div className="space-y-1.5">
            <Label>Company (optional)</Label>
            <Select value={draft.vendorId} onValueChange={(v) => setDraft((d) => ({ ...d, vendorId: v }))}>
              <SelectTrigger><SelectValue placeholder="Select subcontractor" /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Daily Rate</Label><Input type="number" value={draft.dailyRate} onChange={(e) => setDraft((d) => ({ ...d, dailyRate: e.target.value }))} /></div>
        </div>
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
