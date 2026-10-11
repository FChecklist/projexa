"use client";

// "+ Connect to AI" -- the one entry to AI in PROJEXA (owner order 2026-10-11). The button sits under the chat box; the grey chat box opens the same
// panel. It slides in from the RIGHT and has four parts, in this order:
//   1. Connect an AI for me      the eight AIs (ChatGPT, Claude, Gemini, Copilot, DeepSeek, z.ai, Grok, Others), each with a write-up and, where the
//                                company sells a key, the key form. Only this person uses it unless they share it.
//   2. Share my AI               tick the teammates who may use my connection; they are connected automatically, and I can stop it at any time.
//   3. My organisation's AI      an owner/admin connects one AI for the whole organisation; everyone is connected automatically.
//   Each AI card has two parts: A. work from the AI's WEBSITE (a step-by-step wizard that makes the person's PROJEXA code, says where to click, and then
//   CHECKS whether the AI really used it, naming the usual mistakes when it did not) and B. chat INSIDE PROJEXA with a developer key. The old "paste
//   this prompt into a chat" button is gone (it cannot work reliably).
// The key is tested once, stored locked by VERIDIAN (compliance-tracker src/lib/ai/org-own-ai.ts) and never shown again; this file keeps it in the
// input box only until the request ends. Without any AI connected PROJEXA is ordinary software: every menu, form and button works.
import { useCallback, useEffect, useRef, useState } from "react";
import { Plug } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { WebsiteWizard } from "@/components/ai-link/WebsiteWizard";
import { CONNECT_PROVIDERS, OWN_KEY_VENDORS, checkKeyFormat, modelFor, type ConnectProvider, type OwnKeyVendor } from "@/components/ai-link/connect-your-ai-providers";
import { ROLE_GROUPS } from "@/lib/authz/roles";
import { AI_CONNECTION_CHANGED_EVENT, OPEN_CONNECT_AI_EVENT, announceAiConnectionChanged, describeEffective, useAiConnection, type PersonRef } from "@/lib/ai-connection";

export const CONNECT_PANEL_SAFETY =
  "Your key is like a password. PROJEXA tests it once, stores it locked, and never shows it again. Your AI company bills the account the key belongs to. Every change an AI makes follows each person's own role and is recorded.";

export function canManageOrgAi(role: string | null | undefined): boolean {
  return !!role && (ROLE_GROUPS.ORG_ADMIN as readonly string[]).includes(role);
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

export type Scope = "me" | "org";

/** Sends one key to PROJEXA. Pure of React so it can be tested; the key is passed through, never stored here. */
export async function submitConnection(
  scope: Scope,
  input: { provider: OwnKeyVendor; model: string; apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const formatProblem = checkKeyFormat(input.provider, input.apiKey);
  if (formatProblem) return { ok: false, error: formatProblem };
  try {
    const res = await fetchImpl(scope === "org" ? "/api/org/own-ai" : "/api/org/own-ai/mine", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: input.provider, model: input.model.trim() || undefined, apiKey: input.apiKey.trim() }),
    });
    if (!res.ok) return { ok: false, error: await errorOf(res, "Could not connect. Nothing was saved.") };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach PROJEXA. Check your internet and try again; nothing was saved." };
  }
}

/** The key form. The key sits in an uncontrolled box and is wiped as soon as the request ends. */
export function OwnKeyForm({ scope, provider, showVendorPicker = false, testId }: { scope: Scope; provider: ConnectProvider | null; showVendorPicker?: boolean; testId: string }) {
  const startVendor: OwnKeyVendor = provider?.ownKey?.vendor ?? "openai";
  const [vendor, setVendor] = useState<OwnKeyVendor>(startVendor);
  const [model, setModel] = useState(provider ? modelFor(provider) : OWN_KEY_VENDORS[startVendor].defaultModel);
  const keyRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function connect() {
    setBusy(true);
    setMessage(null);
    const result = await submitConnection(scope, { provider: vendor, model, apiKey: keyRef.current?.value ?? "" });
    setBusy(false);
    if (result.ok) {
      if (keyRef.current) keyRef.current.value = "";
      setMessage({ ok: true, text: scope === "org" ? `Connected. Everyone in your organisation is now connected to ${OWN_KEY_VENDORS[vendor].label}.` : `Connected. Your chat box now works with ${OWN_KEY_VENDORS[vendor].label}.` });
      announceAiConnectionChanged();
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--color-ct-border2)", background: "var(--color-ct-cloud)" }} data-testid={testId}>
      <label className="block text-[12px] font-semibold" htmlFor={`${testId}-key`}>Paste your key</label>
      <input
        id={`${testId}-key`}
        ref={keyRef}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="Paste the key here"
        className="w-full rounded-md border px-2 py-1.5 text-[13px]"
        style={{ borderColor: "var(--color-ct-border2)" }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void connect(); } }}
      />
      {showVendorPicker ? (
        <select value={vendor} onChange={(e) => { const v = e.target.value as OwnKeyVendor; setVendor(v); setModel(OWN_KEY_VENDORS[v].defaultModel); }} className="w-full rounded-md border px-2 py-1 text-[13px]" style={{ borderColor: "var(--color-ct-border2)" }} aria-label="AI company">
          {(Object.keys(OWN_KEY_VENDORS) as OwnKeyVendor[]).map((v) => <option key={v} value={v}>{OWN_KEY_VENDORS[v].label}</option>)}
        </select>
      ) : (
        <details className="text-[12px]">
          <summary className="cursor-pointer" style={{ color: "var(--color-ct-slate)" }}>Change the model (most people skip this)</summary>
          <input value={model} onChange={(e) => setModel(e.target.value)} className="mt-2 w-full rounded-md border px-2 py-1" style={{ borderColor: "var(--color-ct-border2)" }} aria-label="Model name" />
        </details>
      )}
      <Button type="button" size="sm" onClick={() => void connect()} disabled={busy} data-testid={`${testId}-connect`}>
        {busy ? "Testing your key…" : "Test and connect"}
      </Button>
      {message ? <p role={message.ok ? "status" : "alert"} className="text-[12px]" style={{ color: message.ok ? "var(--color-ct-teal)" : "var(--color-veri-status-late)" }}>{message.text}</p> : null}
    </div>
  );
}

function ProviderBody({ provider, role }: { provider: ConnectProvider; role: string | null | undefined }) {
  return (
    <div className="space-y-5 text-[13px]">
      <section aria-label={`${provider.name}: work from its website`} className="space-y-2">
        <h4 className="font-semibold" style={{ color: "var(--color-ct-navy)" }}>A. Work in PROJEXA from {provider.name}&apos;s website</h4>
        <WebsiteWizard provider={provider} role={role} />
      </section>
      <section aria-label={`${provider.name}: chat inside PROJEXA`} className="space-y-2">
        <h4 className="font-semibold" style={{ color: "var(--color-ct-navy)" }}>B. Or chat inside PROJEXA with {provider.name}</h4>
        {provider.ownKey ? (
          <>
            <p style={{ color: "var(--color-ct-slate)" }}>This needs a developer key from {provider.ownKey.keyFrom} (not your website password or plan). Get it here:</p>
            <ol className="list-decimal space-y-0.5 pl-5" style={{ color: "var(--color-ct-slate)" }}>
              {provider.ownKey.getKey.map((t) => <li key={t}>{t}</li>)}
            </ol>
            {provider.ownKey.note ? <p className="text-[12px]" style={{ color: "var(--color-ct-slate)" }}>{provider.ownKey.note}</p> : null}
            <OwnKeyForm scope="me" provider={provider} testId={`own-key-${provider.id}`} />
          </>
        ) : (
          <p style={{ color: "var(--color-ct-slate)" }}>{provider.noKeyNote}</p>
        )}
      </section>
    </div>
  );
}

/** "Share my AI": tick the teammates who may use my connection. */
export function SharePicker({ people, shared, onSaved }: { people: Array<PersonRef & { role?: string }>; shared: PersonRef[]; onSaved: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(shared.map((p) => p.id)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setPicked(new Set(shared.map((p) => p.id))); }, [shared]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/org/own-ai/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userIds: [...picked] }) });
      if (!res.ok) throw new Error(await errorOf(res, "Could not save who can use your AI."));
      setMessage({ ok: true, text: picked.size === 0 ? "Saved. Nobody else uses your AI." : `Saved. ${picked.size} teammate${picked.size === 1 ? " is" : "s are"} now connected through your AI.` });
      announceAiConnectionChanged();
      onSaved();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not save who can use your AI." });
    } finally {
      setBusy(false);
    }
  }

  if (people.length === 0) return <p className="text-[12px]" style={{ color: "var(--color-ct-slate)" }}>There is nobody else in your organisation to share with yet.</p>;
  return (
    <div className="space-y-2" data-testid="share-picker">
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {people.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={picked.has(p.id)} onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} data-testid={`share-${p.id}`} />
              <span>{p.name}</span>
              {p.role ? <span className="text-[11px]" style={{ color: "var(--color-ct-slate)" }}>{p.role}</span> : null}
            </label>
          </li>
        ))}
      </ul>
      <Button type="button" size="sm" onClick={() => void save()} disabled={busy} data-testid="share-save">{busy ? "Saving…" : "Save who can use my AI"}</Button>
      {message ? <p role={message.ok ? "status" : "alert"} className="text-[12px]" style={{ color: message.ok ? "var(--color-ct-teal)" : "var(--color-veri-status-late)" }}>{message.text}</p> : null}
    </div>
  );
}

function Heading({ n, children }: { n: number; children: string }) {
  return <h3 className="text-[14px] font-semibold" style={{ color: "var(--color-ct-navy)" }}>{n}. {children}</h3>;
}

/** The panel's content (exported so it can be tested without the sheet's portal). */
export function ConnectPanelBody({ role }: { role: string | null | undefined }) {
  const { picture, refresh } = useAiConnection();
  const [people, setPeople] = useState<Array<PersonRef & { role?: string }>>([]);
  const [removing, setRemoving] = useState<Scope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = canManageOrgAi(role);
  const mineConnected = picture?.mine.connected === true;

  const loadPeople = useCallback(async () => {
    try {
      const res = await fetch("/api/org/own-ai/people");
      if (res.ok) setPeople(((await res.json()) as { people: Array<PersonRef & { role?: string }> }).people ?? []);
    } catch {
      /* offline: sharing waits until the connection is back */
    }
  }, []);
  useEffect(() => { if (mineConnected) void loadPeople(); }, [mineConnected, loadPeople]);

  async function disconnect(scope: Scope) {
    setRemoving(scope);
    setError(null);
    try {
      const res = await fetch(scope === "org" ? "/api/org/own-ai" : "/api/org/own-ai/mine", { method: "DELETE" });
      if (!res.ok) throw new Error(await errorOf(res, "Could not disconnect."));
      announceAiConnectionChanged();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setRemoving(null);
    }
  }

  const vendorName = (v: keyof typeof OWN_KEY_VENDORS | null) => (v ? OWN_KEY_VENDORS[v].label : "");
  return (
    <div className="space-y-5 px-4 pb-6 text-[13px]" data-testid="connect-panel-body">
      <div className="rounded-lg border p-3" data-testid="own-ai-status" style={{ borderColor: "var(--color-ct-border2)" }}>
        <p className="font-semibold" style={{ color: picture?.effective.connected ? "var(--color-ct-teal)" : "var(--color-ct-navy)" }}>
          {picture ? describeEffective(picture.effective) : "Checking your AI…"}
        </p>
        {error ? <p role="alert" className="mt-1 text-[12px]" style={{ color: "var(--color-veri-status-late)" }}>{error}</p> : null}
      </div>

      <section aria-label="Connect an AI for me" className="space-y-2">
        <Heading n={1}>Connect an AI for me</Heading>
        <p style={{ color: "var(--color-ct-slate)" }}>Pick the AI you use. Each one shows, step by step, how to connect it and how to check that it worked. Only you use it, unless you share it below.</p>
        {mineConnected ? (
          <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-ct-border2)" }} data-testid="mine-connected">
            <p className="font-semibold" style={{ color: "var(--color-ct-teal)" }}>Connected: {vendorName(picture!.mine.provider)}{picture!.mine.model ? ` · ${picture!.mine.model}` : ""}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void disconnect("me")} disabled={removing === "me"} data-testid="mine-disconnect">
              {removing === "me" ? "Disconnecting…" : "Disconnect and erase my key"}
            </Button>
          </div>
        ) : null}
        <Accordion type="single" collapsible data-testid="connect-provider-list">
          {CONNECT_PROVIDERS.map((p) => (
            <AccordionItem key={p.id} value={p.id} data-testid={`connect-provider-${p.id}`}>
              <AccordionTrigger className="text-left">
                <span>
                  <span className="block text-[14px] font-semibold" style={{ color: "var(--color-ct-navy)" }} data-testid={`connect-provider-name-${p.id}`}>{p.name}</span>
                  <span className="block text-[12px] font-normal" style={{ color: "var(--color-ct-slate)" }}>{p.summary}</span>
                </span>
              </AccordionTrigger>
              <AccordionContent><ProviderBody provider={p} role={role} /></AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section aria-label="Share my AI" className="space-y-2">
        <Heading n={2}>Share my AI with teammates</Heading>
        {mineConnected ? (
          <>
            <p style={{ color: "var(--color-ct-slate)" }}>Teammates you tick can chat with the AI key you connected inside PROJEXA (part B of an AI above); your AI company bills you for what they use. You can stop it any time.</p>
            <SharePicker people={people} shared={picture!.mine.sharedWith} onSaved={() => void refresh()} />
          </>
        ) : (
          <p style={{ color: "var(--color-ct-slate)" }}>Connect your own AI above first; then you can choose who else may use it.</p>
        )}
      </section>

      <section aria-label="My organisation's AI" className="space-y-2">
        <Heading n={3}>My organisation&apos;s AI</Heading>
        <p style={{ color: "var(--color-ct-slate)" }}>One AI for everyone in your organisation. Nobody has to do anything: they are connected automatically.</p>
        {picture?.org.connected ? (
          <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-ct-border2)" }} data-testid="org-connected">
            <p className="font-semibold" style={{ color: "var(--color-ct-teal)" }}>Connected: {vendorName(picture.org.provider)}{picture.org.model ? ` · ${picture.org.model}` : ""}</p>
            {isAdmin ? (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void disconnect("org")} disabled={removing === "org"} data-testid="org-disconnect">
                {removing === "org" ? "Disconnecting…" : "Disconnect and erase the key"}
              </Button>
            ) : null}
          </div>
        ) : null}
        {isAdmin ? <OwnKeyForm scope="org" provider={null} showVendorPicker testId="org-key" /> : (
          <p className="text-[12px]" data-testid="org-admin-only" style={{ color: "var(--color-ct-slate)" }}>Only your organisation&apos;s owner or admin can connect the organisation&apos;s AI.</p>
        )}
      </section>

      <p className="text-[12px]" style={{ color: "var(--color-ct-slate)" }}>{CONNECT_PANEL_SAFETY}</p>
    </div>
  );
}

/** Calls `open` whenever anything (the grey chat box) asks for the Connect panel. */
export function useOpenOnConnectEvent(open: () => void): void {
  useEffect(() => {
    window.addEventListener(OPEN_CONNECT_AI_EVENT, open);
    return () => window.removeEventListener(OPEN_CONNECT_AI_EVENT, open);
  }, [open]);
}

/** The "+ Connect to AI" button, and the panel it opens on the right. The grey chat box opens it too, through OPEN_CONNECT_AI_EVENT. */
export default function ConnectYourAiPanel({ role, label = "+ Connect to AI", prominent = false }: { role: string | null | undefined; label?: string; prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  const openPanel = useCallback(() => setOpen(true), []);
  useOpenOnConnectEvent(openPanel);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={`w-full justify-center text-[12px] ${prominent ? "border-2 border-[#2DD4BF] bg-[#14C8B4] font-semibold text-white hover:bg-[#2DD4BF] hover:text-white" : ""}`}
        onClick={() => setOpen(true)}
        data-testid="connect-your-ai-open"
      >
        <Plug className="size-3.5" aria-hidden /> {label}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg" data-testid="connect-your-ai-panel">
          <SheetHeader>
            <SheetTitle>Connect to AI</SheetTitle>
            <SheetDescription>Connect an AI and it does your work in PROJEXA: create, edit, add and delete, inside your role. Without one, PROJEXA works as normal software.</SheetDescription>
          </SheetHeader>
          <ConnectPanelBody role={role} />
        </SheetContent>
      </Sheet>
    </>
  );
}

export { AI_CONNECTION_CHANGED_EVENT };
