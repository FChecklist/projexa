"use client";

// LOCAL-FIRST shell, group "ERP B" (accounting, budgets, quotations, sales orders, invoices, sales, HR): the few pieces its screens share.
// Reads nothing itself; see erp-b-adapter.ts for what the laptop has and what it deliberately does not.

import type { ReactNode } from "react";
import { formatAmount } from "@/lib/boq-helpers";
import { orgStateWords } from "../../org-local";
import type { ShellApi } from "../types";
import { DASH, Screen, ServerOnly } from "./DeliveryParts";
import { formatInBase, type Currency } from "./org-masters";

export const MAX_ROWS = 500;

/** The calm answer when the kind is not there: the role is not sent it, or it has not been copied yet. Never an error. */
export function GateScreen({ testId, title, state, what }: { testId: string; title: string; state: "not_allowed" | "not_synced"; what: string }) {
  return (
    <Screen testId={testId} state={state} title={title}>
      <p className="mt-3 text-sm text-px-muted">{orgStateWords(state, what)}</p>
    </Screen>
  );
}

/** One money figure exactly as the server sent it: "Hidden for your role" when the sync hid it, a dash when it is unknown. */
export function MoneyCell({ value, hidden, currency }: { value: number | null; hidden: boolean; currency: Currency | null }) {
  if (hidden) return <span className="text-px-muted" data-hidden="1">Hidden for your role</span>;
  if (value === null) return <>{DASH}</>;
  return <>{formatInBase(value, currency) ?? formatAmount(value)}</>;
}

/** "partially_paid" -> "partially paid"; a status the screen does not know is shown as it is. */
export const statusWords = (s: string | null): string => (s === null ? DASH : s.replace(/_/g, " "));

export const dateOrDash = (d: string | null): string => d ?? DASH;

/** Header rows only: says plainly that the line items are on the server (a link when online, calm words offline). */
export function LinesOnServer({ shell, what, path }: { shell: ShellApi; what: string; path: string }) {
  return <ServerOnly shell={shell} what={`${what} are on the server, not on this laptop.`} path={path} />;
}

export function Facts({ rows, testId }: { rows: ReadonlyArray<[string, ReactNode]>; testId: string }) {
  return (
    <dl className="mt-4 grid max-w-xl grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid={testId}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-px-muted">{k}</dt>
          <dd className="text-px-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const selectClass = "mt-3 block rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm";
