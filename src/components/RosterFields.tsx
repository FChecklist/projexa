"use client";

// R67 D-34 (R-085): the roster's own fields, written once and used by BOTH the
// create screen and the edit mode of the object page.
//
// They used to be two copies with two behaviours: create refused an empty name
// silently, edit refused it with a toast, neither said which field was wrong,
// Trade was free text on both (so "Mason", "mason" and "Masonry" all became
// different trades and split every trade-wise total downstream), Daily Rate
// carried no currency and no input mode, and neither field was marked required.
import { useEffect, useState } from "react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import {
  rosterFieldMessage,
  ADD_TRADE_OPTION, ADD_TRADE_LABEL, DIRECT_HIRE_OPTION, DIRECT_HIRE_LABEL,
  type RosterFieldKey,
} from "@/lib/roster-form";

export type Vendor = { id: string; vendorName: string };

export type RosterFieldValues = {
  employeeCode: string;
  name: string;
  trade: string;
  vendorId: string;
  dailyRate: string;
};

/** Loads the org's trade vocabulary. Seeds merged with what the org has actually used, so switching Trade to a Select never hides a value someone already typed. */
export function useTrades(): string[] {
  const [trades, setTrades] = useState<string[]>([]);
  useEffect(() => {
    fetchJson<{ trades?: string[] }>("/api/labour-roster/trades")
      .then((d) => setTrades(d.trades ?? []))
      // A failed lookup must not block adding a worker: the "+ Add trade…"
      // escape hatch below still works with an empty list.
      .catch(() => setTrades([]));
  }, []);
  return trades;
}

export default function RosterFields({
  values,
  onChange,
  vendors,
  trades,
  currency,
  touched,
  onBlurField,
}: {
  values: RosterFieldValues;
  onChange: (field: keyof RosterFieldValues, value: string) => void;
  vendors: Vendor[];
  trades: string[];
  currency: string;
  /** Which fields have been blurred -- a message appears when the user leaves a field, not while they are still typing into it. */
  touched: Partial<Record<RosterFieldKey, boolean>>;
  onBlurField: (field: RosterFieldKey) => void;
}) {
  const [addingTrade, setAddingTrade] = useState(false);

  const nameError = touched.name ? rosterFieldMessage("name", values, currency) : null;
  const rateError = touched.dailyRate ? rosterFieldMessage("dailyRate", values, currency) : null;

  // A trade the org has used but that is not in the list yet (an existing
  // worker being edited) must still show as the current value, or opening Edit
  // would silently clear it.
  const tradeOptions = values.trade && !trades.includes(values.trade) ? [values.trade, ...trades] : trades;

  return (
    <div className="space-y-3 px-4 py-3">
      <FormField label="ID (optional)" hint="Left blank, a worker number is generated (W-0001, W-0002, …).">
        {(props) => (
          <Input {...props} value={values.employeeCode} onChange={(e) => onChange("employeeCode", e.target.value)} placeholder="e.g. EMP-001" />
        )}
      </FormField>

      <FormField
        label="Name"
        required
        error={nameError ? <span className="inline-flex items-center gap-1"><span aria-hidden="true">⚠</span>{nameError}</span> : null}
      >
        {(props) => (
          <Input {...props} value={values.name} onChange={(e) => onChange("name", e.target.value)} onBlur={() => onBlurField("name")} />
        )}
      </FormField>

      <FormField label="Trade" hint="Trade drives every trade-wise attendance and cost total.">
        {(props) =>
          addingTrade ? (
            <Input
              {...props}
              autoFocus
              value={values.trade}
              placeholder="Type the trade, e.g. Tiler"
              onChange={(e) => onChange("trade", e.target.value)}
              onBlur={() => { if (!values.trade.trim()) setAddingTrade(false); }}
            />
          ) : (
            <Select
              value={values.trade}
              onValueChange={(v) => {
                if (v === ADD_TRADE_OPTION) { onChange("trade", ""); setAddingTrade(true); return; }
                onChange("trade", v);
              }}
            >
              <SelectTrigger {...props}><SelectValue placeholder="Choose a trade" /></SelectTrigger>
              <SelectContent>
                {tradeOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                <SelectItem value={ADD_TRADE_OPTION}>{ADD_TRADE_LABEL}</SelectItem>
              </SelectContent>
            </Select>
          )
        }
      </FormField>

      <FormField label="Company">
        {(props) => (
          <Select value={values.vendorId || DIRECT_HIRE_OPTION} onValueChange={(v) => onChange("vendorId", v === DIRECT_HIRE_OPTION ? "" : v)}>
            <SelectTrigger {...props}><SelectValue /></SelectTrigger>
            <SelectContent>
              {/* Not a blank first option: "no subcontractor" is a real answer
                  about this worker, and saying it out loud is the difference
                  between a direct hire and an unanswered question. */}
              <SelectItem value={DIRECT_HIRE_OPTION}>{DIRECT_HIRE_LABEL}</SelectItem>
              {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </FormField>

      <FormField
        label="Daily Rate"
        required
        error={rateError ? <span className="inline-flex items-center gap-1"><span aria-hidden="true">⚠</span>{rateError}</span> : null}
      >
        {(props) => (
          <div className="relative">
            {currency && (
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[12px] text-px-muted">{currency.trim()}</span>
            )}
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min={0}
              className={`${currency ? "pl-14" : ""} pr-14`}
              value={values.dailyRate}
              onChange={(e) => onChange("dailyRate", e.target.value)}
              onBlur={() => onBlurField("dailyRate")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-px-muted">/ day</span>
          </div>
        )}
      </FormField>
    </div>
  );
}
