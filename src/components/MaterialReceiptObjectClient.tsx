"use client";

// R67 D-36 (audit R-105): the inbound receipt had no object page and no way
// back from a mistake. A mis-keyed quantity was permanent -- it sat in the
// ledger and in the Cost Report for ever, because nothing on either side of
// the API could update or remove a receipt.
//
// This page is read-only by design (a receipt is a record of what arrived on
// site, not a form) and carries exactly one action: VOID, with a required
// reason, stating its blast radius in real numbers before it is taken. The
// void is soft -- the row stays in the Inbound list, struck through, with the
// reason on hover -- and only the TOTALS change. A delete would silently
// rewrite the ledger the Cost Report is computed from.
//
// The confirm is inline rather than a dialog, matching RosterObjectClient's
// own deactivate confirm.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDateNumeric } from "@/lib/format-date";
import { formatQty } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";

type Receipt = {
  id: string;
  projectId: string;
  materialId: string;
  receivedDate: string;
  quantity: string;
  unitCost: string | null;
  vendorId: string | null;
  reference: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  recordedByName: string | null;
  voidedByName: string | null;
  material?: { id: string; name: string; unit: string } | null;
};
type Vendor = { id: string; vendorName: string };

/**
 * The void confirmation, as its own presentational component: it owns no
 * state and no networking, which is what lets its exact labels and its
 * "a reason is required" gate be unit tested directly. Exported for that
 * test -- the object page below is its only production caller.
 */
export function VoidConfirm({
  blastRadius,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  busy,
  error,
}: {
  blastRadius: string;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const hasReason = reason.trim().length > 0;
  return (
    <div role="alertdialog" aria-label="Confirm void" className="space-y-2 border-t border-ct-border bg-px-error-light px-4 py-3">
      <p className="text-[13px] text-px-error">{blastRadius}</p>
      <div className="space-y-1.5">
        <Label htmlFor="void-reason" className="text-[12.5px] text-px-error">Reason:</Label>
        <Textarea
          id="void-reason"
          rows={2}
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder="e.g. Quantity keyed wrong — 5 bags, not 50"
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || !hasReason}
          title={!hasReason ? "A reason is required" : undefined}
          onClick={onConfirm}
        >
          {busy ? "Voiding…" : hasReason ? "Void" : "Void (A reason is required)"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
      {error && <p role="alert" className="text-[13px] text-px-error">{error}</p>}
    </div>
  );
}

export default function MaterialReceiptObjectClient({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  // R67 G-05 merge: the org's currency is resolved once for the screen and the
  // formatter comes back bound to it, so no cell can be rendered with the wrong
  // currency by forgetting to pass one.
  const orgMoney = useOrgMoney();
  const money = orgMoney.money;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [data, vendorData] = await Promise.all([
        fetchJson<Receipt>(`/api/materials/${receiptId}`),
        fetchJson<{ vendors?: Vendor[] }>("/api/vendors").catch(() => ({ vendors: [] })),
      ]);
      setReceipt(data);
      setVendors(vendorData.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setReceipt(null);
      setLoadError(errorMessage(err, "Couldn't load this receipt"));
    }
  }, [receiptId]);
  useEffect(() => { void load(); }, [load]);

  async function voidReceipt() {
    if (!reason.trim()) return;
    setVoiding(true);
    setActionError(null);
    try {
      const data = await fetchJson<Receipt>(`/api/materials/${receiptId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", voidReason: reason.trim() }),
      });
      toast.success("Receipt voided");
      // Re-read rather than trusting the PATCH's row: the object page shows
      // the resolved voider NAME, which only the GET carries.
      setReceipt({ ...data, recordedByName: receipt?.recordedByName ?? null, voidedByName: null });
      setConfirming(false);
      setReason("");
      void load();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't void this receipt"));
    } finally {
      setVoiding(false);
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
  if (!receipt) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const materialName = receipt.material?.name ?? "—";
  const unit = receipt.material?.unit ?? "";
  const vendorName = vendors.find((v) => v.id === receipt.vendorId)?.vendorName ?? "—";
  const lineTotal = Number(receipt.quantity) * Number(receipt.unitCost ?? 0);
  const isVoided = !!receipt.voidedAt;

  // The blast radius, in this receipt's own real numbers.
  const blastRadius = `Voiding removes ${formatQty(receipt.quantity)} ${unit} from Received to date and ${money(lineTotal)} from the Cost Report.`;

  return (
    <KitObjectScreen
      breadcrumb={`Materials / Receipts / ${formatDateNumeric(receipt.receivedDate)}${receipt.reference ? ` ${receipt.reference}` : ""} ${materialName}`}
      title={materialName}
      mode="display"
      hasDraft={false}
      headerStatus={isVoided ? { tone: "late", label: "voided" } : { tone: "done", label: "recorded" }}
      facets={[
        { label: "Date", value: formatDateNumeric(receipt.receivedDate) },
        { label: "Vendor", value: vendorName },
        { label: "Reference", value: receipt.reference ?? "—" },
        { label: "Quantity", value: `${formatQty(receipt.quantity)} ${unit}`.trim() },
        { label: "Unit Cost", value: money(receipt.unitCost) },
      ]}
      onDelete={isVoided ? undefined : () => setConfirming(true)}
      deleteLabel="Void"
      deleteDisabledReason={voiding ? "Voiding…" : undefined}
      onBack={() => router.push(`/materials?projectId=${receipt.projectId}&tab=receipts`)}
      messages={[]}
    >
      {isVoided && (
        <div role="status" className="border-t border-ct-border bg-px-error-light px-4 py-3 text-[13px] text-px-error">
          Voided{receipt.voidedByName ? ` by ${receipt.voidedByName}` : ""} on {formatDateNumeric(receipt.voidedAt!)} — {receipt.voidReason ?? "no reason recorded"}.
          This receipt is excluded from Received to date and from the Cost Report; the row is kept.
        </div>
      )}

      {confirming && !isVoided && (
        <VoidConfirm
          blastRadius={blastRadius}
          reason={reason}
          onReasonChange={setReason}
          onConfirm={() => void voidReceipt()}
          onCancel={() => { setConfirming(false); setReason(""); setActionError(null); }}
          busy={voiding}
          error={actionError}
        />
      )}

      <section className="border-t border-ct-border px-4 py-3">
        <h2 className="mb-2 text-[13px] font-medium text-ct-slate">Details</h2>
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          <div className="text-[12.5px]">
            <dt className="inline text-ct-muted">Date: </dt>
            <dd className="inline font-medium text-ct-navy">{formatDateNumeric(receipt.receivedDate)}</dd>
          </div>
          <div className="text-[12.5px]">
            <dt className="inline text-ct-muted">Material: </dt>
            <dd className="inline font-medium">
              {receipt.material ? (
                <button
                  type="button"
                  className="text-[color:var(--color-veri-status-context)] underline underline-offset-2"
                  onClick={() => router.push(`/materials/${receipt.material!.id}`)}
                >
                  {materialName}
                </button>
              ) : (
                <span className="text-ct-navy">—</span>
              )}
            </dd>
          </div>
          {[
            { label: "Vendor", value: vendorName },
            { label: "Reference", value: receipt.reference ?? "—" },
            { label: "Quantity", value: `${formatQty(receipt.quantity)} ${unit}`.trim() },
            { label: "Unit Cost", value: money(receipt.unitCost) },
            { label: "Line total", value: money(lineTotal) },
            { label: "Recorded by", value: receipt.recordedByName ?? "—" },
          ].map((field) => (
            <div key={field.label} className="text-[12.5px]">
              <dt className="inline text-ct-muted">{field.label}: </dt>
              <dd className="inline font-medium text-ct-navy">{field.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </KitObjectScreen>
  );
}
