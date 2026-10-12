"use client";

// Sumeet R-100 (profit and loss): the margin on Project 360 is computed from the FIRST confirmed baseline of the project's BOQ, and nothing could create
// one -- every project read "Not yet baselined" for ever. This is the one deliberate WRITE on the Project 360 screen: it needs the server (a baseline is
// a record the server stamps with who confirmed it and what evidence they named), so it is offered only while the laptop is online, only while the
// project's analysis says no baseline exists, and it asks for the evidence first (a PO, a signed proposal, an email: D88).
// The same control lives on the server-rendered page (components/Project360Client.tsx); the installed shell draws THIS screen instead.

import { useState } from "react";
import { viaPxApi } from "@/lib/px-api";

export type BaselineFormProps = {
  boqId: string;
  online: boolean;
  /** Called after the server confirmed: the screen re-reads the analysis. */
  onConfirmed: () => void;
  fetchImpl?: typeof fetch;
};

export default function Project360BaselineForm({ boqId, online, onConfirmed, fetchImpl }: BaselineFormProps) {
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!online) {
    return <p data-testid="baseline-needs-connection" className="mt-2 text-xs text-px-muted">Confirming a baseline needs a connection: the server records who confirmed it and on what evidence.</p>;
  }

  async function confirm() {
    if (!evidence.trim()) {
      setError("Name the evidence first — a PO, a signed proposal, an email — so the baseline can be checked later.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await (fetchImpl ?? viaPxApi)(`/api/scope/${encodeURIComponent(boqId)}/revisions?action=baseline`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ evidenceArtefactRef: evidence.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(typeof body?.error === "string" && body.error ? `The baseline was not confirmed: ${body.error}` : `The baseline was not confirmed (HTTP ${res.status}).`);
        return;
      }
      setEvidence("");
      onConfirmed();
    } catch {
      setError("The baseline was not confirmed: the server did not answer. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="baseline-form" className="mt-3 flex flex-wrap items-start gap-2">
      <input
        aria-label="Evidence for the baseline"
        className="h-9 w-full max-w-md rounded-md border border-black/15 px-3 text-sm"
        placeholder="Evidence: PO number, signed proposal, email date…"
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        disabled={busy}
      />
      <button type="button" data-testid="baseline-confirm" className="h-9 rounded-md bg-px-accent px-4 text-sm font-medium text-white disabled:opacity-60" onClick={() => void confirm()} disabled={busy}>
        {busy ? "Confirming…" : "Confirm baseline"}
      </button>
      {error ? <p role="alert" className="w-full text-xs text-px-error">{error}</p> : null}
    </div>
  );
}
