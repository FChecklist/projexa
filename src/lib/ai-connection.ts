"use client";

// "Connect your AI": what the browser knows about WHICH AI answers this person. One read of GET /api/org/own-ai (the proxy of VERIDIAN's /own-ai), shared by
// the chat box (grey until an AI is connected), the Connect panel and the local shell. No key ever reaches the browser: the answer is vendor / model / names.
//
// The answer is remembered in localStorage so the chat box does not flash grey on every page load and still shows the right state offline. Offline the AI
// cannot answer anyway (it is a call to the AI company); everything else in the app is unaffected. Every storage access is wrapped: private windows and
// blocked storage must never break a screen.
import { useCallback, useEffect, useState } from "react";

export type AiVendor = "openai" | "anthropic" | "google" | "groq" | "openrouter";
export type AiSource = "mine" | "shared" | "org" | "projexa";
export type PersonRef = { id: string; name: string };

export type AiPicture = {
  effective: { connected: boolean; source: AiSource | null; provider: AiVendor | null; model: string | null; sharedByName: string | null };
  mine: { connected: boolean; provider: AiVendor | null; model: string | null; sharedWith: PersonRef[] };
  sharedWithMe: Array<{ ownerName: string; provider: AiVendor; model: string }>;
  org: { connected: boolean; provider: AiVendor | null; model: string | null };
};

/** Fired after a connect / disconnect / share so every mounted reader (chat box, panel, local shell) re-reads. */
export const AI_CONNECTION_CHANGED_EVENT = "px-ai-connection-changed";
/** Fired by anything that wants the Connect panel opened (the grey chat box). The panel listens. */
export const OPEN_CONNECT_AI_EVENT = "px-open-connect-ai";

const CACHE_KEY = "px-ai-connected-v1";

export function announceAiConnectionChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AI_CONNECTION_CHANGED_EVENT));
}
export function requestOpenConnectAi(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_CONNECT_AI_EVENT));
}

function readCache(): boolean | null {
  try {
    const v = window.localStorage.getItem(CACHE_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}
function writeCache(connected: boolean): void {
  try {
    window.localStorage.setItem(CACHE_KEY, connected ? "1" : "0");
  } catch {
    /* storage blocked: the screen still works */
  }
}

export type AiConnectionState = {
  /** false until the first answer (or a remembered one) is known; the chat box stays open meanwhile, never flashing grey. */
  known: boolean;
  connected: boolean;
  picture: AiPicture | null;
  refresh: () => Promise<void>;
};

export async function fetchAiPicture(fetchImpl: typeof fetch = fetch): Promise<AiPicture | null> {
  try {
    const res = await fetchImpl("/api/org/own-ai");
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<AiPicture> | null;
    // Only a well-formed answer counts: an error body, an empty object or a proxy page must never flip the chat box.
    if (!body || typeof body.effective?.connected !== "boolean" || !body.mine || !body.org) return null;
    return body as AiPicture;
  } catch {
    return null;
  }
}

export function useAiConnection(): AiConnectionState {
  const [picture, setPicture] = useState<AiPicture | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);

  useEffect(() => { setCached(readCache()); }, []);

  const refresh = useCallback(async () => {
    const p = await fetchAiPicture();
    if (!p) return; // offline or the service is down: keep what we know
    setPicture(p);
    writeCache(p.effective.connected);
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => { void refresh(); };
    window.addEventListener(AI_CONNECTION_CHANGED_EVENT, onChanged);
    window.addEventListener("online", onChanged);
    return () => {
      window.removeEventListener(AI_CONNECTION_CHANGED_EVENT, onChanged);
      window.removeEventListener("online", onChanged);
    };
  }, [refresh]);

  const known = picture !== null || cached !== null;
  const connected = picture ? picture.effective.connected : cached === true;
  return { known, connected, picture, refresh };
}

/** The one plain sentence for the status line. */
export function describeEffective(e: AiPicture["effective"]): string {
  const vendor: Record<AiVendor, string> = { openai: "ChatGPT (OpenAI)", anthropic: "Claude (Anthropic)", google: "Gemini (Google)", groq: "Groq", openrouter: "OpenRouter" };
  const name = e.provider ? vendor[e.provider] : "";
  switch (e.source) {
    case "mine": return `Using your own AI: ${name}`;
    case "shared": return `Using ${e.sharedByName ?? "a teammate"}'s AI, shared with you: ${name}`;
    case "org": return `Using your organisation's AI: ${name}`;
    case "projexa": return "Using PROJEXA's own AI (switched on for your organisation)";
    default: return "No AI connected yet. PROJEXA works as normal software; connect an AI to type requests.";
  }
}
