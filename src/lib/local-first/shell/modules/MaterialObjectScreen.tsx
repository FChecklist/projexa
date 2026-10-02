"use client";

// LOCAL-FIRST shell, one material (/materials/:id): its facts, stock counted on this laptop, and its receipts and issues. Editing the
// master (unit, cost, reorder level) is done online: unit cost is money.

import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Money, Num, Screen, StateMessage, Waiting, withProject } from "./DeliveryParts";
import type { MaterialData } from "./materials-adapter";

export default function MaterialObjectScreen({ data }: ShellScreenProps<MaterialData>) {
  if (data.state !== "local") return <StateMessage testId="material" title="Material" state={data.state} what="material" back={{ href: "/materials", label: "Back to Materials" }} />;
  const m = data.material;
  const p = data.projectId;
  return (
    <Screen testId="material" state="local" title={m.name}>
      <CopyNote testId="material-copy-note" syncedAt={data.syncedAt} />
      <dl className="mt-4 grid max-w-xl grid-cols-[11rem_1fr] gap-y-2 rounded-lg border border-black/10 bg-white p-4 text-sm">
        <dt className="text-px-muted">On hand (this laptop)</dt><dd className={m.low ? "font-semibold text-red-800" : ""}><Num value={m.onHand} />{m.unit ? ` ${m.unit}` : ""}{m.low ? " · below reorder level" : ""}</dd>
        <dt className="text-px-muted">Received to date</dt><dd><Num value={m.receivedToDate} /></dd>
        <dt className="text-px-muted">Issued to date</dt><dd><Num value={m.issuedToDate} /></dd>
        <dt className="text-px-muted">Reorder level</dt><dd><Num value={m.reorderLevel} /></dd>
        <dt className="text-px-muted">Spec</dt><dd>{m.spec ?? DASH}</dd>
        <dt className="text-px-muted">Unit</dt><dd>{m.unit ?? DASH}</dd>
        <dt className="text-px-muted">Unit Cost</dt><dd><Money value={m.unitCost} hidden={data.costHidden} /></dd>
      </dl>
      <p className="mt-3 flex gap-3 text-sm">
        <a className="text-px-ink underline underline-offset-2" href={withProject(`/materials/receipts/new?materialId=${encodeURIComponent(m.id)}`, p)}>Record receipt</a>
        <a className="text-px-ink underline underline-offset-2" href={withProject(`/materials/issues/new?materialId=${encodeURIComponent(m.id)}`, p)}>Issue material</a>
      </p>
      <h2 className="mt-6 font-heading text-lg text-px-ink">Movements</h2>
      {data.receipts === null || data.issues === null ? (
        <p className="mt-2 text-sm text-px-muted">Receipts or issues have not finished copying to this laptop yet.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm" data-testid="material-movements">
          {[...data.receipts.map((r) => ({ id: r.id, date: r.receivedDate, text: `Received ${r.quantity}${r.reference ? ` (${r.reference})` : ""}${r.voided ? " — voided" : ""}`, waiting: r.waiting })),
            ...data.issues.map((i) => ({ id: i.id, date: i.issuedDate, text: `Issued ${i.quantity}${i.issuedTo ? ` to ${i.issuedTo}` : ""}`, waiting: i.waiting }))]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((x) => <li key={x.id}>{x.date} · {x.text}<Waiting on={x.waiting} /></li>)}
          {data.receipts.length + data.issues.length === 0 ? <li className="text-px-muted">Nothing received or issued yet.</li> : null}
        </ul>
      )}
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={withProject("/materials", p)}>Back to Materials</a></p>
    </Screen>
  );
}
