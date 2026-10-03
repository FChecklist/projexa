"use client";

// LOCAL-FIRST shell, Sales (/sales): a hub over the quotation, sales order and invoice headers on the laptop. It shows how many of each
// there are (a count of rows, never a sum of money) and links to each list. Leads and opportunities are not on this laptop.

import type { ShellScreenProps } from "../types";
import { CopyNote, Screen } from "./DeliveryParts";
import { DOC_SPECS, type SalesHubData } from "./erp-b-adapter";

export default function SalesHubScreen({ data }: ShellScreenProps<SalesHubData>) {
  const local = data.kinds.filter((k) => k.state === "local");
  const syncedAt = local.length ? Math.max(...local.map((k) => (k.state === "local" ? k.syncedAt : 0))) : null;
  return (
    <Screen testId="sales" state={local.length ? "local" : data.kinds[0]?.state ?? "not_synced"} title="Sales">
      {syncedAt ? <CopyNote testId="sales-copy-note" syncedAt={syncedAt} /> : null}
      <ul className="mt-4 grid max-w-xl gap-2">
        {data.kinds.map((k) => {
          const spec = DOC_SPECS[k.kind];
          return (
            <li key={k.kind} className="rounded-lg border border-black/10 bg-white p-3 text-sm" data-testid="sales-card" data-kind={k.kind} data-state={k.state}>
              {k.state === "local" ? (
                <a className="font-medium text-px-ink underline underline-offset-2" href={spec.base}>{spec.plural}</a>
              ) : (
                <span className="font-medium text-px-ink">{spec.plural}</span>
              )}
              <span className="ml-2 text-px-muted">
                {k.state === "local"
                  ? `${k.count} on this laptop`
                  : k.state === "not_allowed"
                    ? `not available to your role`
                    : "not on this laptop yet"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-px-muted" data-testid="sales-note">Leads and opportunities are on the server, not on this laptop. Only the headers of quotations, orders and invoices are kept here; their line items are on the server.</p>
    </Screen>
  );
}
