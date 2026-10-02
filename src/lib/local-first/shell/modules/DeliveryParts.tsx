"use client";

// LOCAL-FIRST shell, cluster "delivery": the small pieces every delivery screen shares -- the calm state messages, the "saved on this
// laptop" note, tabs as plain links (the shell intercepts them), cells that say "hidden for your role" instead of a number, and the
// one form-submit helper (keeps the person's input on a refusal, refreshes the screen after a save, never shows a dialog).

import { useState, type ReactNode } from "react";
import { formatAmount } from "@/lib/boq-helpers";
import { formatDateTime } from "@/lib/format-date";
import { serverPageUrl } from "../paths";
import type { ShellApi } from "../types";
import { canOfferWrites, refusalText, type WriteResult } from "./delivery-writes";

/** Whether this person is offered the delivery writes (see canOfferWrites: a read-only role is not). */
export function mayWrite(shell: ShellApi): boolean {
  return canOfferWrites(shell.data.role);
}

/** What a read-only role sees where a form or a write control would be. */
export function ReadOnlyNote() {
  return <p className="mt-4 text-sm text-px-muted" data-testid="delivery-read-only">Your role can see this but not change it.</p>;
}

export const DASH = "—";

export function projectName(shell: ShellApi, projectId: string | null): string | null {
  return shell.data.projects.find((p) => p.id === projectId)?.name ?? null;
}

export function withProject(href: string, projectId: string | null | undefined): string {
  if (!projectId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(projectId)}`;
}

export function Screen({ testId, state, title, children }: { testId: string; state: string; title: string; children?: ReactNode }) {
  return (
    <section data-testid={testId} data-state={state}>
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      {children}
    </section>
  );
}

/** The four states every delivery adapter can return besides "local", in the same words the BOQ screens use. */
export function StateMessage({ testId, title, state, what, back }: { testId: string; title: string; state: "no_project" | "not_synced" | "not_found" | "invalid_date"; what: string; back?: { href: string; label: string } }) {
  const text =
    state === "no_project"
      ? "There is no project on this laptop yet. Open PROJEXA once while you are online and your projects will be copied here."
      : state === "not_synced"
        ? "This project has not finished copying to this laptop yet. It will appear here as soon as it has, while you are online."
        : state === "invalid_date"
          ? "That is not a date this screen understands."
          : `This ${what} is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.`;
  return (
    <Screen testId={testId} state={state} title={title}>
      <p className="mt-3 text-sm text-px-muted">{text}</p>
      {back ? (
        <p className="mt-3 text-sm">
          <a className="text-px-ink underline underline-offset-2" href={back.href}>{back.label}</a>
        </p>
      ) : null}
    </Screen>
  );
}

export function CopyNote({ testId, syncedAt }: { testId: string; syncedAt: number | null }) {
  return (
    <p className="mt-1 text-xs text-px-muted" data-testid={testId}>
      Saved on this laptop{syncedAt ? ` · last copied ${formatDateTime(syncedAt)}` : ""}
    </p>
  );
}

export function Tabs({ tabs, active, base, projectId }: { tabs: readonly { id: string; label: string }[]; active: string; base: string; projectId: string }) {
  return (
    <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Sections">
      {tabs.map((t) => (
        <a
          key={t.id}
          href={withProject(`${base}?tab=${t.id}`, projectId)}
          aria-current={t.id === active ? "page" : undefined}
          className={t.id === active ? "rounded-md bg-px-ink px-3 py-1 text-white" : "rounded-md border border-black/10 px-3 py-1 text-px-ink"}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

/** A money value: "Hidden for your role" when the sync hid it, a dash when unknown, never a 0 standing in for either. */
export function Money({ value, hidden }: { value: number | null; hidden: boolean }) {
  if (hidden) return <span className="text-px-muted" data-hidden="1">Hidden for your role</span>;
  return <>{value === null ? DASH : formatAmount(value)}</>;
}

export function Num({ value, suffix }: { value: number | null; suffix?: string }) {
  return <>{value === null ? DASH : `${value.toLocaleString("en-IN", { maximumFractionDigits: 3 })}${suffix ?? ""}`}</>;
}

export function Waiting({ on }: { on: boolean }) {
  return on ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900" data-testid="waiting">Waiting to sync</span> : null;
}

/** For something only the server can do: says so plainly; online, a link to the server's page. */
export function ServerOnly({ shell, what, path }: { shell: ShellApi; what: string; path: string }) {
  const online = shell.connectivity === "online";
  return (
    <p className="mt-3 text-sm text-px-muted" data-testid="server-only">
      {what} {online ? (
        // target=_top: a real page load, so the shell's link interceptor (router.ts) leaves it to the browser and the worker sees px-server
        <a className="text-px-ink underline underline-offset-2" target="_top" href={serverPageUrl({ path, search: shell.projectId ? `?projectId=${encodeURIComponent(shell.projectId)}` : "" })}>Open it from the server</a>
      ) : (
        "It will be available here when you are connected."
      )}
    </p>
  );
}

/**
 * The submit helper: runs the writer, says what happened in words under the form, refreshes the screen after a save. A refusal keeps
 * the form as it was (the caller resets only on success).
 */
export function useLocalSave(shell: ShellApi) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(run: () => Promise<WriteResult>): Promise<boolean> {
    setSaving(true);
    try {
      const result = await run();
      if (!result.queued) {
        setNote({ ok: false, text: refusalText(result.reason) });
        return false;
      }
      setNote({ ok: true, text: shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected." });
      shell.refresh();
      return true;
    } catch {
      setNote({ ok: false, text: refusalText("failed") });
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { saving, note, save };
}

export function SaveNote({ note }: { note: { ok: boolean; text: string } | null }) {
  if (!note) return null;
  return (
    <p role="status" data-testid="save-note" data-ok={note.ok ? "1" : "0"} className={`mt-2 text-sm ${note.ok ? "text-px-ink" : "text-red-800"}`}>
      {note.text}
    </p>
  );
}

/**
 * The handlers for a controlled text/date input: the same setter on change AND input. A real keystroke raises both (the second is a
 * no-op); onInput is what the repo's test environment can drive (see ScopeObjectScreen.tsx and src/lib/mom-form.ts's header).
 */
export function textHandlers(set: (value: string) => void) {
  return {
    onChange: (e: { currentTarget: { value: string } }) => set(e.currentTarget.value),
    onInput: (e: { currentTarget: { value: string } }) => set(e.currentTarget.value),
  };
}

export const fieldClass ="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm";
