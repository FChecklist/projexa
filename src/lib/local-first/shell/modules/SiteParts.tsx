"use client";

// LOCAL-FIRST shell, cluster "site": the small pieces the RFI / submittal / punch list / site diary / FF&E / vendor screens share --
// the submit helper (keeps the person's input on a refusal, refreshes the screen after a save, never a dialog), the status chip, and the
// one plain sentence for a change that needs a connection.

import { useState, type ReactNode } from "react";
import type { ShellApi } from "../types";
import { siteRefusalText, type SiteWriteResult } from "./site-writes";

export const words = (s: string | null): string => (s ? s.replace(/_/g, " ") : "-");

export function Chip({ value, testId }: { value: string | null; testId?: string }) {
  return (
    <span className="rounded bg-px-concrete px-1.5 py-0.5 text-xs capitalize text-px-ink" data-testid={testId ?? "status-chip"}>
      {words(value)}
    </span>
  );
}

/** Runs one writer, says in words what happened, refreshes the screen after a save. A refusal keeps the form as it was. */
export function useSiteSave(shell: ShellApi) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(run: () => Promise<SiteWriteResult>): Promise<boolean> {
    setSaving(true);
    try {
      const result = await run();
      if (!result.queued) {
        setNote({ ok: false, text: siteRefusalText(result.reason) });
        return false;
      }
      setNote({
        ok: true,
        text: shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected.",
      });
      shell.refresh();
      return true;
    } catch {
      setNote({ ok: false, text: siteRefusalText("failed") });
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { saving, note, save };
}

/** What the laptop cannot do for this screen, said once and calmly. */
export function NeedsConnection({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 text-xs text-px-muted" data-testid="needs-connection">
      {children}
    </p>
  );
}

export function SectionText({ title, value }: { title: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mt-4">
      <h2 className="text-sm font-medium text-px-ink">{title}</h2>
      <p className="mt-1 whitespace-pre-wrap text-sm text-px-muted">{value}</p>
    </div>
  );
}

export const BACK_LINK = "text-px-ink underline underline-offset-2";
