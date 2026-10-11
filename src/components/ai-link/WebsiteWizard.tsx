"use client";

// "Work from <AI>'s website": the step-by-step wizard under each AI in the Connect panel (owner order 2026-10-11: very simple, step by step, mistakes
// identified and told to the person). Step 1 makes the person's PROJEXA code (the work-link address; shown once, kept only in this component's state,
// never stored); the middle steps say where to click on the AI's own website; the last button CHECKS whether the AI really used the code, and says in
// plain words what is wrong when it did not (connection-check.ts). Nothing here sends the code anywhere but the person's own clipboard.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AWL_CONNECT_PASSWORD_WARNING } from "@/components/ai-link/AiWorkLinkConnect";
import { diagnoseConnection, type Diagnosis } from "@/components/ai-link/connection-check";
import type { ConnectProvider } from "@/components/ai-link/connect-your-ai-providers";
import { AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "@/lib/ai-work-link-access";
import { AwlError, getAwlClient, type AwlClient, type AwlLinkRow } from "@/lib/ai-work-link-client";

const SUPPORT_STYLE: Record<ConnectProvider["website"]["support"], { label: string; color: string }> = {
  works: { label: "Works on its paid plans", color: "var(--color-ct-teal)" },
  depends: { label: "Depends on your plan and country", color: "var(--color-ct-saffron)" },
  no: { label: "Cannot connect from the website", color: "var(--color-veri-status-late)" },
};

const STATE_COLOR: Record<Diagnosis["state"], string> = {
  connected: "var(--color-ct-teal)",
  waiting: "var(--color-ct-saffron)",
  "no-code": "var(--color-ct-saffron)",
  expired: "var(--color-veri-status-late)",
  unreachable: "var(--color-veri-status-late)",
};

export function WebsiteWizard({ provider, role, client, now = () => new Date() }: { provider: ConnectProvider; role: string | null | undefined; client?: AwlClient; now?: () => Date }) {
  const w = provider.website;
  const [link, setLink] = useState<string | null>(null);
  const [madeAt, setMadeAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<"make" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const allowed = !role || canMakeAiWorkLink(role);
  const style = SUPPORT_STYLE[w.support];

  async function make() {
    setBusy("make");
    setError(null);
    setCopied(null);
    setDiagnosis(null);
    const started = now().toISOString();
    try {
      // Level 1 = the AI may create, edit and delete as far as the person's own role allows (owner order: complete work, not only reading).
      const minted = await (client ?? getAwlClient()).mintUserLink({ days: 30, level: 1, label: `${provider.name} connection` });
      setLink(minted.link);
      setMadeAt(started);
    } catch (e) {
      setError(e instanceof AwlError ? e.message : "PROJEXA could not make your code. Check your internet and press the button again.");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  async function check() {
    setBusy("check");
    const c = client ?? getAwlClient();
    let rows: AwlLinkRow[] | null = null;
    try {
      rows = c.listAllLinks ? await c.listAllLinks() : null;
    } catch {
      rows = null;
    }
    setDiagnosis(diagnoseConnection(rows, madeAt, now(), provider.name, w.mistakes));
    setBusy(null);
  }

  const canDoSteps = w.steps.length > 0;
  return (
    <div className="space-y-3 text-[13px]" data-testid={`wizard-${provider.id}`}>
      <p className="rounded-md border px-2 py-1.5" style={{ borderColor: style.color }} data-testid={`wizard-support-${provider.id}`}>
        <span className="font-semibold" style={{ color: style.color }}>{style.label}. </span>
        <span style={{ color: "var(--color-ct-slate)" }}>{w.supportNote}</span>
      </p>

      {canDoSteps ? (
        <ol className="space-y-3">
          <li>
            <p className="font-semibold" style={{ color: "var(--color-ct-navy)" }}>Step 1. Make your PROJEXA code (do this here)</p>
            {!allowed ? (
              <p className="mt-1" style={{ color: "var(--color-ct-slate)" }} data-testid="wizard-role-note">{AI_WORK_LINK_ROLE_NOTE}</p>
            ) : link ? (
              <div className="mt-1 space-y-1.5" data-testid="wizard-code">
                <label className="block text-[12px]" htmlFor={`wizard-address-${provider.id}`}>Your address (copy ALL of it):</label>
                <input id={`wizard-address-${provider.id}`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border px-2 py-1.5 font-mono text-[12px]" style={{ borderColor: "var(--color-ct-border2)" }} />
                <Button type="button" size="sm" onClick={() => void copy()} data-testid="wizard-copy">Copy the address</Button>
                {copied === "yes" ? <p role="status" className="text-[12px]" style={{ color: "var(--color-ct-teal)" }}>Copied. Now follow the next steps and paste it where they say.</p> : null}
                {copied === "failed" ? <p role="alert" className="text-[12px]" style={{ color: "var(--color-veri-status-late)" }}>Your browser did not allow copying. Click inside the box above, press Ctrl+A and then Ctrl+C.</p> : null}
                <p className="text-[12px]" style={{ color: "var(--color-ct-slate)" }}>{AWL_CONNECT_PASSWORD_WARNING}</p>
              </div>
            ) : (
              <Button type="button" size="sm" className="mt-1" onClick={() => void make()} disabled={busy !== null} data-testid="wizard-make">
                {busy === "make" ? "Making your code…" : "Make my PROJEXA code"}
              </Button>
            )}
            {error ? <p role="alert" className="mt-1 text-[12px]" style={{ color: "var(--color-veri-status-late)" }}>{error}</p> : null}
          </li>
          {w.steps.map((t, i) => (
            <li key={t}>
              <p><span className="font-semibold" style={{ color: "var(--color-ct-navy)" }}>Step {i + 2}. </span><span style={{ color: "var(--color-ct-slate)" }}>{t}</span></p>
            </li>
          ))}
          <li>
            <p className="font-semibold" style={{ color: "var(--color-ct-navy)" }}>Step {w.steps.length + 2}. Check that it worked</p>
            <Button type="button" size="sm" variant="outline" className="mt-1" onClick={() => void check()} disabled={busy !== null} data-testid="wizard-check">
              {busy === "check" ? "Checking…" : "Check my connection"}
            </Button>
            {diagnosis ? (
              <div className="mt-2 rounded-md border p-2" style={{ borderColor: STATE_COLOR[diagnosis.state] }} data-testid="wizard-diagnosis" data-state={diagnosis.state} role={diagnosis.state === "connected" ? "status" : "alert"}>
                <p className="font-semibold" style={{ color: STATE_COLOR[diagnosis.state] }}>{diagnosis.title}</p>
                <p className="mt-0.5" style={{ color: "var(--color-ct-slate)" }}>{diagnosis.detail}</p>
                {diagnosis.state === "waiting" ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5" style={{ color: "var(--color-ct-slate)" }} data-testid="wizard-mistakes">
                    {diagnosis.tryThese.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </li>
        </ol>
      ) : null}

      <p style={{ color: "var(--color-ct-slate)" }} data-testid="wizard-if-missing"><span className="font-semibold">If you cannot find it: </span>{w.ifMissing}</p>
      {w.instead ? <p style={{ color: "var(--color-ct-slate)" }}><span className="font-semibold">Instead: </span>{w.instead}</p> : null}
    </div>
  );
}
