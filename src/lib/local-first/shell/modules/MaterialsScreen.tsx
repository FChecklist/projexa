"use client";

// LOCAL-FIRST shell, Materials (/materials): the master with stock counted on this laptop, inbound receipts and issues, from the
// laptop's own copy. The cost report is the server's aggregation (recalculated when online); a receipt's line total is money and is
// not multiplied out here.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Money, Num, Screen, ServerOnly, StateMessage, Tabs, Waiting, projectName, withProject } from "./DeliveryParts";
import type { MaterialsData } from "./materials-adapter";

const TABS = [
  { id: "master", label: "Master" },
  { id: "receipts", label: "Inbound Receipts" },
  { id: "issues", label: "Issues" },
  { id: "cost-report", label: "Cost Report" },
] as const;

export default function MaterialsScreen({ shell, query, data }: ShellScreenProps<MaterialsData>) {
  if (data.state !== "local") return <StateMessage testId="materials" title="Materials" state={data.state} what="material" />;
  const name = projectName(shell, data.projectId);
  const tab = TABS.some((t) => t.id === query.get("tab")) ? query.get("tab")! : "master";
  const p = data.projectId;

  return (
    <Screen testId="materials" state="local" title={`Materials${name ? ` / ${name}` : ""}`}>
      <CopyNote testId="materials-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 flex gap-3 text-sm">
        <a className="text-px-ink underline underline-offset-2" href={withProject("/materials/receipts/new", p)}>Record receipt</a>
        <a className="text-px-ink underline underline-offset-2" href={withProject("/materials/issues/new", p)}>Issue material</a>
      </p>
      <Tabs tabs={TABS} active={tab} base="/materials" projectId={p} />

      {tab === "master" ? (
        data.materials.length === 0 ? (
          <p className="mt-4 text-sm text-px-muted">No materials on this project yet.</p>
        ) : (
          <>
            <p className="mt-3 text-xs text-px-muted" data-testid="materials-stock-note">On hand is counted on this laptop from its receipts and issues, including any waiting to be sent.</p>
            <div className="mt-2 overflow-x-auto rounded-lg border border-black/10 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Spec</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Received to date</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.materials.map((m) => (
                    <TableRow key={m.id} data-testid="materials-row">
                      <TableCell><a className="underline-offset-2 hover:underline" href={withProject(`/materials/${encodeURIComponent(m.id)}`, p)}>{m.name}</a></TableCell>
                      <TableCell>{m.spec ?? DASH}</TableCell>
                      <TableCell>{m.unit ?? DASH}</TableCell>
                      <TableCell className="text-right"><Money value={m.unitCost} hidden={data.costHidden} /></TableCell>
                      <TableCell className="text-right"><Num value={m.receivedToDate} /></TableCell>
                      <TableCell className={`text-right ${m.low ? "font-semibold text-red-800" : ""}`}>
                        <Num value={m.onHand} />{m.low ? " · low" : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )
      ) : tab === "receipts" ? (
        data.receipts === null ? (
          <p className="mt-4 text-sm text-px-muted">Receipts have not finished copying to this laptop yet.</p>
        ) : data.receipts.length === 0 ? (
          <p className="mt-4 text-sm text-px-muted">No receipts recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.receipts.map((r) => (
                  <TableRow key={r.id} data-testid="materials-receipt-row" className={r.voided ? "text-px-muted line-through" : ""}>
                    <TableCell>
                      {r.waiting ? r.receivedDate : <a className="underline-offset-2 hover:underline" href={withProject(`/materials/receipts/${encodeURIComponent(r.id)}`, p)}>{r.receivedDate}</a>}
                      <Waiting on={r.waiting} />
                    </TableCell>
                    <TableCell>{r.materialName ?? DASH}</TableCell>
                    <TableCell>{r.reference ?? DASH}</TableCell>
                    <TableCell className="text-right"><Num value={r.quantity} />{r.unit ? ` ${r.unit}` : ""}</TableCell>
                    <TableCell className="text-right">{r.waiting && !data.costHidden ? "Set by the server" : <Money value={r.unitCost} hidden={data.costHidden} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : tab === "issues" ? (
        data.issues === null ? (
          <p className="mt-4 text-sm text-px-muted">Issues have not finished copying to this laptop yet.</p>
        ) : data.issues.length === 0 ? (
          <p className="mt-4 text-sm text-px-muted">No material issued yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Issued to</TableHead>
                  <TableHead>BOQ item</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.issues.map((i) => (
                  <TableRow key={i.id} data-testid="materials-issue-row">
                    <TableCell>{i.issuedDate}<Waiting on={i.waiting} /></TableCell>
                    <TableCell>{i.materialName ?? DASH}</TableCell>
                    <TableCell>{i.issuedTo ?? DASH}</TableCell>
                    <TableCell>{i.boqLabel ?? DASH}</TableCell>
                    <TableCell className="text-right"><Num value={i.quantity} />{i.unit ? ` ${i.unit}` : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : (
        <div className="mt-4" data-testid="materials-cost-report">
          <p className="text-sm text-px-muted">The cost report is calculated by the server: recalculated when online.</p>
          <ServerOnly shell={shell} what="" path="/materials" />
        </div>
      )}
    </Screen>
  );
}
