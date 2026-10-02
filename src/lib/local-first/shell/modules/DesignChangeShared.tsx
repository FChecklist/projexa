"use client";

// LOCAL-FIRST shell, cluster "design and change": the pieces every screen of Change Orders and the Design Studio shares -- the calm state
// messages, the "saved on this laptop" line, the "waiting to be sent" mark, the role check that decides whether a write is OFFERED, and
// how a screen reaches the writes (design-change-writes.ts). Nothing here shows an error dialog for being offline.
//
// THE ROLE CHECK ONLY DECLINES TO OFFER. `mayOffer` reads the same min_role_rank the server's push gate checks (ai/registry.ts, a copy of
// the AI work link registry); it never grants anything: every op is decided again by the server, as the person with their live role.

import type { ReactNode } from "react";
import { CURRENCY_FALLBACK_LABEL } from "@/lib/currency";
import { formatDateTime } from "@/lib/format-date";
import { findFunction, rankOf } from "../../ai/registry";
import type { Outbox } from "../../outbox";
import type { ShellApi } from "../types";
import type { DesignChangeWriteAccess } from "./design-change-writes";

/** Render tests set `outbox` here to run the screens against a test outbox; the app leaves it empty (the person's shared outbox). */
export const designChangeWriteDeps: { outbox?: Pick<Outbox, "enqueue"> } = {};

export function writeAccess(shell: ShellApi): DesignChangeWriteAccess {
  return { userId: shell.data.userId, idb: shell.data.idb, ...(designChangeWriteDeps.outbox ? { outbox: designChangeWriteDeps.outbox } : {}) };
}

/** Whether this person's role may propose `functionId` (a function the registry does not list is never offered). */
export function mayOffer(role: string | null, functionId: string): boolean {
  const fn = findFunction(functionId);
  return fn !== undefined && rankOf(role) >= fn.min_role_rank;
}

/** What to say after a write was kept on this laptop. */
export function keptNote(shell: ShellApi): string {
  return shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected.";
}

export const NO_PROJECT = "There is no project on this laptop yet. Open PROJEXA once while you are online and your projects will be copied here.";
export const NOT_SYNCED = "This project has not finished copying to this laptop yet. It will appear here as soon as it has, while you are online.";
export const COST_HIDDEN = "Hidden for your role";

export const projectQuery = (projectId: string) => `?projectId=${encodeURIComponent(projectId)}`;

export function StateMessage({ testId, state, title, back, children }: { testId: string; state: string; title: string; back?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section data-testid={testId} data-state={state}>
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <p className="mt-3 text-sm text-px-muted">{children}</p>
      {back ? (
        <p className="mt-3 text-sm">
          <a className="text-px-ink underline underline-offset-2" href={back.href}>{back.label}</a>
        </p>
      ) : null}
    </section>
  );
}

export function CopyNote({ testId, syncedAt }: { testId: string; syncedAt: number | null }) {
  return (
    <p className="mt-1 text-xs text-px-muted" data-testid={testId}>
      Saved on this laptop{syncedAt ? ` · last copied ${formatDateTime(syncedAt)}` : ""}
    </p>
  );
}

/** "Waiting to be sent" (or the server's refusal) next to a row with something in the outbox. */
export function PendingMark({ word }: { word: string | null }) {
  return word ? <span data-testid="dc-waiting" className="ml-2 rounded bg-px-concrete px-1.5 py-0.5 text-xs text-px-muted">{word}</span> : null;
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-px-muted">{label}</dt>
          <dd className="text-px-ink" data-testid={`fact-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The plain "this needs a connection" line for what the laptop cannot do (not synced, or no registered function). */
export function OnlineOnly({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-xs text-px-muted" data-testid="dc-online-only">{children}</p>;
}

/**
 * A change order's cost impact as the online screens print it (whole units, the deployment's currency code: the organisation's own base
 * currency is an org master the laptop does not consume yet), red for an increase and green for a saving. "Hidden for your role" when
 * the sync hid it; a dash when not set. Never a 0 standing in for either.
 */
export function CoMoney({ value, hidden }: { value: number | null; hidden: boolean }) {
  if (hidden) return <span className="text-px-muted" data-hidden="1">{COST_HIDDEN}</span>;
  if (value === null) return <span className="text-px-muted">—</span>;
  return <span className={value >= 0 ? "text-px-error" : "text-px-success"}>{`${CURRENCY_FALLBACK_LABEL}${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}</span>;
}

export function Note({ text }: { text: string | null }) {
  return text ? <p className="mt-2 text-xs text-px-muted" data-testid="dc-note">{text}</p> : null;
}
