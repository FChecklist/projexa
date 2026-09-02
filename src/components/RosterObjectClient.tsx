"use client";

// Real-screen conversion (2026-08-30): roster entries never had a detail view
// or any way to edit/deactivate a worker short of re-creating them. Real
// Delete = real Deactivate (isActive: false), matching Budget's
// Cancel-as-Delete / Documents' Dispose-as-Delete convention.
//
// R67 D-34 (R-085): the edit fields were a second, independent copy of the
// create form's -- refusing an empty name with a toast where the create screen
// refused it silently, with free-text Trade and an unmarked, uncurrencied Daily
// Rate. They are now the SAME component (RosterFields) reading the SAME
// validation model (src/lib/roster-form.ts), on the D-09 ObjectScreen fork so
// Deactivate is rendered-with-a-reason on an already-inactive worker rather
// than silently absent.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { ObjectContext } from "@/components/shell/shell-screen-context";
import { Button } from "@/components/ui/button";
import RosterFields, { useTrades, type RosterFieldValues, type Vendor } from "@/components/RosterFields";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { missingRosterFields, missingRosterReason, rosterFieldMessage, type RosterFieldKey } from "@/lib/roster-form";

type RosterEntry = { id: string; projectId: string; name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: string; isActive: boolean };

const EMPTY: RosterFieldValues = { employeeCode: "", name: "", trade: "", vendorId: "", dailyRate: "" };

export default function RosterObjectClient({ rosterId, createdNotice }: { rosterId: string; createdNotice?: string | null }) {
  const router = useRouter();
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
  const [deactivating, setDeactivating] = useState(false);

  async function load() {
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
  }
  useEffect(() => { load(); }, [rosterId]);

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

  async function deactivate() {
    setDeactivating(true);
    try {
      const data = await fetchJson<RosterEntry>(`/api/labour-roster/${rosterId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      setEntry(data);
      setMessages([{ level: "info", text: "Worker deactivated" }]);
    } catch (err) {
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't deactivate this worker") }]);
    } finally {
      setDeactivating(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!entry) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const vendorName = vendors.find((v) => v.id === entry.vendorId)?.vendorName ?? "Direct hire";

  return (
    <>
    {/* R67 A-21: the composer's strip names this worker and their project --
        "<project> › Worker Ramesh Kumar" -- instead of the module. Published
        after the fetch, which is when this page first knows either. */}
    <ObjectContext moduleId="labour" label={entry.name} projectId={entry.projectId} />
    <ObjectScreen
      breadcrumb="Labour / Worker"
      title={mode === "edit" ? "Edit Worker" : entry.name}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: entry.isActive ? "done" : "late", label: entry.isActive ? "active" : "inactive" }}
      facets={[
        { label: "ID", value: entry.employeeCode ?? "—" },
        { label: "Trade", value: entry.trade ?? "—" },
        { label: "Company", value: vendorName },
        { label: "Daily Rate", value: `${currency}${entry.dailyRate} / day` },
      ]}
      onEdit={mode === "display" ? startEdit : undefined}
      editDisabledReason={mode === "display" && !entry.isActive ? "This worker is inactive" : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => { setMode("display"); setMessages([]); } : undefined}
      onDelete={mode === "display" ? deactivate : undefined}
      // Rendered-with-a-reason rather than absent (the D-09 fork's whole
      // point): on an already-inactive worker the control stays visible and
      // says why it is not offered.
      deleteDisabledReason={deactivating ? "Deactivating…" : !entry.isActive ? "Already inactive" : mode === "edit" ? "Finish editing first" : undefined}
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
    </ObjectScreen>
    </>
  );
}
