"use client";

// Real-screen conversion (2026-08-30): the Inventory Items list never had a
// detail view -- standardBuyingRate/standardSellingRate/hsnSacCode/
// hasSerialNo were all accepted on create but never shown anywhere again.
// No Edit: no updateItem() exists server-side -- an honest scope cut.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Item = {
  id: string; itemCode: string; itemName: string; uom: string | null;
  standardBuyingRate: string | null; standardSellingRate: string | null;
  hasBatchNo: boolean; hasSerialNo: boolean; hsnSacCode: string | null;
};

export default function ItemObjectClient({ itemId }: { itemId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [item, setItem] = useState<Item | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchJson<Item>(`/api/inventory/items/${itemId}`);
      setItem(data);
      setLoadError(null);
    } catch (err) {
      setItem(null);
      setLoadError(errorMessage(err, "Couldn't load this item"));
    }
  }

  useEffect(() => { load(); }, [itemId]);

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!item) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const label = currencyLabel(undefined, currencies);

  return (
    <ObjectScreen
      breadcrumb="Inventory / Item"
      title={item.itemName}
      subtitle={item.itemCode}
      mode="display"
      hasDraft={false}
      facets={[
        { label: "UOM", value: item.uom ?? "—" },
        { label: "Batch Tracked", value: item.hasBatchNo ? "Yes" : "No" },
        { label: "Serial Tracked", value: item.hasSerialNo ? "Yes" : "No" },
      ]}
      onBack={() => router.push("/inventory?tab=items")}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <div><dt className="text-ct-muted">Standard Buying Rate</dt><dd className="text-ct-navy">{item.standardBuyingRate ? `${label}${Number(item.standardBuyingRate).toLocaleString()}` : "—"}</dd></div>
          <div><dt className="text-ct-muted">Standard Selling Rate</dt><dd className="text-ct-navy">{item.standardSellingRate ? `${label}${Number(item.standardSellingRate).toLocaleString()}` : "—"}</dd></div>
          <div><dt className="text-ct-muted">HSN/SAC Code</dt><dd className="text-ct-navy">{item.hsnSacCode ?? "—"}</dd></div>
        </dl>
      </div>
    </ObjectScreen>
  );
}
