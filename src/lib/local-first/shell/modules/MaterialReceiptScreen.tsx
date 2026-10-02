"use client";

// LOCAL-FIRST shell, one receipt (/materials/receipts/:id). Voiding a receipt is an approval-class action (void_material_receipt,
// manager rank): done online. The line total is money: not multiplied out on the laptop.

import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Money, Num, Screen, StateMessage, withProject } from "./DeliveryParts";
import type { ReceiptData } from "./materials-adapter";

export default function MaterialReceiptScreen({ data }: ShellScreenProps<ReceiptData>) {
  if (data.state !== "local") return <StateMessage testId="material-receipt" title="Receipt" state={data.state} what="receipt" back={{ href: "/materials?tab=receipts", label: "Back to receipts" }} />;
  const r = data.receipt;
  return (
    <Screen testId="material-receipt" state="local" title={`Receipt · ${r.materialName ?? "material"} · ${r.receivedDate}`}>
      <CopyNote testId="material-receipt-copy-note" syncedAt={data.syncedAt} />
      {r.voided ? <p className="mt-2 text-sm font-semibold text-red-800" data-testid="material-receipt-voided">Voided{r.voidReason ? `: ${r.voidReason}` : ""}</p> : null}
      <dl className="mt-4 grid max-w-xl grid-cols-[10rem_1fr] gap-y-2 rounded-lg border border-black/10 bg-white p-4 text-sm">
        <dt className="text-px-muted">Date</dt><dd>{r.receivedDate}</dd>
        <dt className="text-px-muted">Material</dt><dd>{r.materialName ?? DASH}</dd>
        <dt className="text-px-muted">Reference</dt><dd>{r.reference ?? DASH}</dd>
        <dt className="text-px-muted">Quantity</dt><dd><Num value={r.quantity} />{r.unit ? ` ${r.unit}` : ""}</dd>
        <dt className="text-px-muted">Unit Cost</dt><dd><Money value={r.unitCost} hidden={data.costHidden} /></dd>
        <dt className="text-px-muted">Notes</dt><dd>{r.notes ?? DASH}</dd>
      </dl>
      <p className="mt-3 text-sm text-px-muted">Voiding a receipt is done while you are online.</p>
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/materials?tab=receipts", data.projectId)}>Back to receipts</a></p>
    </Screen>
  );
}
