// LOCAL-FIRST shell, FF&E (/ffe/:id): one item from the laptop's copy (site-records.ts), plus the vendor's NAME when the organisation's
// vendor master is on the laptop (vendors-adapter.ts) and the role may see the vendor at all. The vendor id of an item is money-sensitive
// (it is hidden below the role that sees cost): hidden stays hidden, and an id with no name on the laptop is never shown as if it were a name.

import { orgMasters } from "./org-masters";
import type { ShellData } from "../context";
import { loadFfeItem, type LocalFfeItem, type ObjectData } from "./site-records";

export type FfeItemWithVendor = LocalFfeItem & { vendorName: string | null };

export async function loadFfeItemWithVendor(data: ShellData, id: string, projectId: string | null): Promise<ObjectData<FfeItemWithVendor>> {
  const r = await loadFfeItem(data, id, projectId);
  if (r.state !== "local") return r;
  let vendorName: string | null = null;
  if (r.item.vendorId && !r.item.vendorHidden) {
    const names = await orgMasters.vendorNames({ userId: data.userId, ...(data.idb ? { idb: data.idb } : {}) });
    if (names.state === "local") vendorName = names.names.get(r.item.vendorId) ?? null;
  }
  return { ...r, item: { ...r.item, vendorName } };
}
