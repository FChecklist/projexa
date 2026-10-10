"use client";

// Defect D1 (2026-10-10): invoices could not be generated because an organisation
// had no tax template and PROJEXA had no way to create one. This is the small
// form shown on the billing page where the "no tax template" message sits.
// Flow: make sure the CGST/SGST/IGST tax accounts exist (idempotent on the
// backend), then create one template whose lines point at those accounts.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export type TaxAccount = { id: string; accountName: string };
export type TaxMode = "intra" | "inter";

type Result = { ok: true; payload: { name: string; isSalesTax: true; items: { taxAccountId: string; rate: number }[] } } | { ok: false; error: string };

/** Add two percentages without float noise (9 + 9 = 18, 2.5 + 2.5 = 5). */
const addPct = (a: number, b: number) => Math.round((a + b) * 100) / 100;

function parseRate(label: string, raw: string): { rate: number } | { error: string } {
  if (raw.trim() === "") return { error: `${label} rate is required` };
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { error: `${label} rate must be a number between 0 and 100` };
  return { rate };
}

export function defaultTemplateName(mode: TaxMode, cgst: number, sgst: number, igst: number): string {
  return mode === "intra" ? `GST ${addPct(cgst, sgst)}% (CGST ${cgst} + SGST ${sgst})` : `IGST ${igst}%`;
}

/**
 * Pure and exported so the money rules are tested without a DOM: intra-state
 * = CGST + SGST lines, inter-state = one IGST line; each rate 0-100; every
 * line must resolve to a real tax account of the organisation.
 */
export function buildTaxTemplatePayload(
  mode: TaxMode, customName: string | null, cgstRaw: string, sgstRaw: string, igstRaw: string, accounts: TaxAccount[]
): Result {
  const find = (n: string) => accounts.find((a) => a.accountName.trim().toUpperCase() === n);
  const lines = mode === "intra" ? ([["CGST", cgstRaw], ["SGST", sgstRaw]] as const) : ([["IGST", igstRaw]] as const);
  const items: { taxAccountId: string; rate: number }[] = [];
  const rates: Record<string, number> = {};
  for (const [label, raw] of lines) {
    const r = parseRate(label, raw);
    if ("error" in r) return { ok: false, error: r.error };
    const account = find(label);
    if (!account) return { ok: false, error: `The ${label} tax account is missing` };
    rates[label] = r.rate;
    items.push({ taxAccountId: account.id, rate: r.rate });
  }
  const name = (customName ?? "").trim() || defaultTemplateName(mode, rates.CGST ?? 0, rates.SGST ?? 0, rates.IGST ?? 0);
  return { ok: true, payload: { name, isSalesTax: true, items } };
}

export default function TaxTemplateForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const [mode, setMode] = useState<TaxMode>("intra");
  const [cgst, setCgst] = useState("9");
  const [sgst, setSgst] = useState("9");
  const [igst, setIgst] = useState("18");
  const [customName, setCustomName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const numeric = (s: string) => (s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : 0);
  const shownName = customName ?? defaultTemplateName(mode, numeric(cgst), numeric(sgst), numeric(igst));

  async function create() {
    setSaving(true);
    try {
      const seeded = await fetchJson<{ taxAccounts?: TaxAccount[] }>("/api/tax-templates/accounts", { method: "POST" });
      const built = buildTaxTemplatePayload(mode, customName, cgst, sgst, igst, seeded.taxAccounts ?? []);
      if (!built.ok) {
        toast.error(built.error);
        return;
      }
      await fetchJson("/api/tax-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.payload),
      });
      toast.success("Tax template created");
      await onCreated();
    } catch (err) {
      toast.error(errorMessage(err, "The tax template was not created"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-px-border bg-px-cloud/40 p-3" data-testid="tax-template-form">
      <div className="space-y-1.5">
        <Label htmlFor="tt-mode">Supply type</Label>
        <select
          id="tt-mode"
          className="h-9 w-56 rounded-md border border-px-border bg-transparent px-3 text-sm"
          value={mode}
          onChange={(e) => { setMode(e.target.value as TaxMode); setCustomName(null); }}
        >
          <option value="intra">Within state (CGST + SGST)</option>
          <option value="inter">Between states (IGST)</option>
        </select>
      </div>
      {mode === "intra" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="tt-cgst">CGST %</Label>
            <Input id="tt-cgst" type="number" min={0} max={100} step="0.01" className="w-24" value={cgst} onChange={(e) => setCgst(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tt-sgst">SGST %</Label>
            <Input id="tt-sgst" type="number" min={0} max={100} step="0.01" className="w-24" value={sgst} onChange={(e) => setSgst(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="tt-igst">IGST %</Label>
          <Input id="tt-igst" type="number" min={0} max={100} step="0.01" className="w-24" value={igst} onChange={(e) => setIgst(e.target.value)} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="tt-name">Template name</Label>
        <Input id="tt-name" className="w-64" value={shownName} onChange={(e) => setCustomName(e.target.value)} />
      </div>
      <Button size="sm" disabled={saving} onClick={() => void create()} data-testid="tax-template-create">
        {saving ? "Creating…" : "Create tax template"}
      </Button>
    </div>
  );
}
