"use client";

// Real-screen conversion (2026-08-30): replaces LabourClient.tsx's old "Add
// Worker" Dialog popup with a real create screen.
//
// R67 D-34 (R-085): the roster is where every trade-wise number downstream
// comes from, and this form was the weakest in the product -- neither required
// field was marked, an empty name was refused with a toast rather than at the
// field, Trade was free text (so "Mason", "mason" and "Masonry" split every
// trade-wise total), and Daily Rate carried no currency, no /day and no input
// mode. The fields now live in RosterFields, shared with the object page's edit
// mode, and every message routes through the ObjectScreen band as well as the
// field, so a failed save is never silent.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import RosterFields, { useTrades, type RosterFieldValues, type Vendor } from "@/components/RosterFields";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { missingRosterFields, missingRosterReason, rosterFieldMessage, type RosterFieldKey } from "@/lib/roster-form";

const EMPTY: RosterFieldValues = { employeeCode: "", name: "", trade: "", vendorId: "", dailyRate: "" };

export default function RosterCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const currency = currencyLabel(undefined, currencies);
  const trades = useTrades();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [values, setValues] = useState<RosterFieldValues>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<RosterFieldKey, boolean>>>({});
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ vendors?: Vendor[] }>("/api/vendors").then((d) => setVendors(d.vendors ?? [])).catch(() => setVendors([]));
  }, []);

  const missing = missingRosterFields(values);

  function blurField(field: RosterFieldKey) {
    setTouched((t) => ({ ...t, [field]: true }));
    const message = rosterFieldMessage(field, values, currency);
    // The same sentence goes to the footer band as well as under the field --
    // the item's own requirement, and the reason a user who has scrolled past
    // the field still learns why Save is refusing.
    setMessages(message ? [{ field, level: "error", text: message }] : []);
  }

  async function createRoster() {
    if (missing.length > 0) {
      setTouched({ name: true, dailyRate: true });
      setMessages(missing.map((field) => ({ field, level: "error" as const, text: rosterFieldMessage(field, values, currency)! })));
      return;
    }
    setSubmitting(true);
    setMessages([]);
    try {
      const entry = await fetchJson<{ id: string; employeeCode: string | null; name: string }>("/api/labour-roster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: values.name.trim(),
          employeeCode: values.employeeCode.trim() || undefined,
          trade: values.trade.trim() || undefined,
          vendorId: values.vendorId || undefined,
          dailyRate: Number(values.dailyRate),
        }),
      });
      // R67 D-34: the success line can NAME the worker now, because a blank ID
      // is generated server-side instead of being stored as null.
      const label = entry.employeeCode ? `Worker ${entry.employeeCode} added` : `Worker ${entry.name} added`;
      router.push(`/labour/${entry.id}?created=${encodeURIComponent(label)}`);
    } catch (err) {
      // The backend's own words, in the persistent band, never a toast that is
      // gone before the user has read it.
      setMessages([{ level: "error", text: errorMessage(err, "Couldn't add this worker") }]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Labour / New Worker"
      title="New Worker"
      mode="create"
      hasDraft={false}
      onSave={createRoster}
      onCancel={() => router.push(`/labour?projectId=${projectId}`)}
      onBack={() => router.push(`/labour?projectId=${projectId}`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Adding…" : missingRosterReason(values)}
      messages={messages}
    >
      <RosterFields
        values={values}
        onChange={(field, value) => {
          setValues((v) => ({ ...v, [field]: value }));
          setMessages([]);
        }}
        vendors={vendors}
        trades={trades}
        currency={currency}
        touched={touched}
        onBlurField={blurField}
      />
    </ObjectScreen>
  );
}
