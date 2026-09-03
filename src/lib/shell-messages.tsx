"use client";

// R67 WS-C (C-14) -- THE SHELL'S OWN MESSAGE REGION, ABOVE THE COMPOSER.
//
// R-282, and the reason it is not a toast. A page form saves, the route
// changes, and the only confirmation the product ever gave was a sonner toast
// that had already faded by the time the destination finished rendering. So
// the answer to "did that save?" was: look at the list and count. On a phone
// on site, with a page still loading, that is not an answer.
//
// THE FOUR RULES THIS FILE IS:
//
//   1. A MESSAGE IS WORDS, NOT A TOAST. It sits in a region the user can look
//      back at, and it stays until something changes.
//   2. IT SURVIVES EXACTLY ONE NAVIGATION -- the one the save itself causes.
//      That is the whole point: the receipt has to outlive the redirect it
//      triggered. The NEXT navigation is the user moving on, and it clears.
//   3. IDENTICAL KINDS GROUP WITH A COUNT. Four saves in a row are "4 saved"
//      plus four lines, not four separate things to read.
//   4. AN ERROR CARRIES ITS WAY OUT. `retry` renders "Try again"; without one
//      the message still says what happened rather than nothing.
//
// The pure half (everything above the React section) is asserted directly in
// shell-messages.test.tsx; the provider is a thin wrapper over it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

export type ShellMessageKind = "saved" | "error" | "info";

export type ShellMessageInput = {
  kind: ShellMessageKind;
  /** The whole sentence. "Saved — Worker Rakesh Kumar". */
  text: string;
  /** Where the object is. Renders an "Open" link. */
  href?: string;
  /** The word on that link, when "Open" is not the right one. */
  linkLabel?: string;
  /**
   * For an error: what "Try again" does. NOT persisted across a navigation --
   * see parseMessages. A retry that outlived its own page would re-post a body
   * the new page knows nothing about.
   */
  retry?: () => void;
};

export type ShellMessage = ShellMessageInput & {
  id: string;
  at: number;
  /** How many navigations this message has already survived. */
  navs: number;
};

/** More than this and the region is a log, not a message. Oldest go first. */
export const MAX_SHELL_MESSAGES = 4;

/** Survives the navigation a save causes; cleared by the next one. */
export const MAX_NAVIGATIONS = 1;

export const SHELL_MESSAGES_KEY = "veri.shell.messages";

// ---------------------------------------------------------------------------
// THE PURE HALF
// ---------------------------------------------------------------------------

/** C-14's own shape: "Saved — <Label> <id or title>". */
export function savedText(label: string, idOrTitle: string | null | undefined): string {
  const tail = (idOrTitle ?? "").trim();
  return tail ? `Saved — ${label} ${tail}` : `Saved — ${label}`;
}

export function appendMessage(
  list: readonly ShellMessage[],
  message: ShellMessage,
  max = MAX_SHELL_MESSAGES
): ShellMessage[] {
  // Newest last, so the region reads in the order things happened -- and the
  // one that just happened is nearest the composer the user is looking at.
  const next = [...list.filter((m) => m.id !== message.id), message];
  return next.slice(Math.max(0, next.length - max));
}

export function removeMessage(list: readonly ShellMessage[], id: string): ShellMessage[] {
  return list.filter((m) => m.id !== id);
}

/**
 * One navigation older. A message that has already survived its own is gone.
 *
 * C-14: "Messages persist across the navigation that follows a save ... and
 * clear on the next user-initiated navigation."
 */
export function advanceNavigation(list: readonly ShellMessage[], max = MAX_NAVIGATIONS): ShellMessage[] {
  return list.map((m) => ({ ...m, navs: m.navs + 1 })).filter((m) => m.navs <= max);
}

export type ShellMessageGroup = {
  kind: ShellMessageKind;
  /** "2 saved" -- printed only when there is more than one of a kind. */
  label: string | null;
  messages: ShellMessage[];
};

const KIND_WORD: Readonly<Record<ShellMessageKind, string>> = {
  saved: "saved",
  error: "failed",
  info: "notes",
};

/** Identical kinds together, in the order their first message arrived. */
export function groupMessages(list: readonly ShellMessage[]): ShellMessageGroup[] {
  const order: ShellMessageKind[] = [];
  const byKind = new Map<ShellMessageKind, ShellMessage[]>();
  for (const m of list) {
    if (!byKind.has(m.kind)) {
      byKind.set(m.kind, []);
      order.push(m.kind);
    }
    byKind.get(m.kind)!.push(m);
  }
  return order.map((kind) => {
    const messages = byKind.get(kind)!;
    return { kind, label: messages.length > 1 ? `${messages.length} ${KIND_WORD[kind]}` : null, messages };
  });
}

/**
 * The sentence C-13 asks a system failure to post here: "The service was
 * unavailable at 10:42 — Retry". The TIME is the useful half -- it tells a
 * foreman whether this is happening now or happened while they were driving.
 */
export function serviceUnavailableText(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `The service was unavailable at ${hh}:${mm}`;
}

export function serialiseMessages(list: readonly ShellMessage[]): string {
  // `retry` is a function and is deliberately dropped: see ShellMessageInput.
  return JSON.stringify(
    list.map(({ id, kind, text, href, linkLabel, at, navs }) => ({ id, kind, text, href, linkLabel, at, navs }))
  );
}

const KINDS: readonly string[] = ["saved", "error", "info"];

/**
 * Untrusted input. This blob survives a deploy, so a shape from an older
 * build -- or one a person edited by hand in devtools -- must produce an empty
 * region, never a crash and never a half-rendered message.
 */
export function parseMessages(raw: string | null | undefined): ShellMessage[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ShellMessage[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (typeof m.id !== "string" || typeof m.text !== "string" || !m.text.trim()) continue;
    if (typeof m.kind !== "string" || !KINDS.includes(m.kind)) continue;
    out.push({
      id: m.id,
      kind: m.kind as ShellMessageKind,
      text: m.text,
      href: typeof m.href === "string" ? m.href : undefined,
      linkLabel: typeof m.linkLabel === "string" ? m.linkLabel : undefined,
      at: typeof m.at === "number" && Number.isFinite(m.at) ? m.at : Date.now(),
      navs: typeof m.navs === "number" && Number.isFinite(m.navs) ? m.navs : 0,
    });
  }
  return out.slice(Math.max(0, out.length - MAX_SHELL_MESSAGES));
}

// ---------------------------------------------------------------------------
// THE REACT HALF
// ---------------------------------------------------------------------------

export type ShellMessagesApi = {
  messages: ShellMessage[];
  push: (message: ShellMessageInput) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

const NO_MESSAGES: ShellMessagesApi = {
  messages: [],
  push: () => {},
  dismiss: () => {},
  clear: () => {},
};

const ShellMessagesContext = createContext<ShellMessagesApi>(NO_MESSAGES);

/** Safe outside the shell: every member is a no-op, nothing throws. */
export function useShellMessages(): ShellMessagesApi {
  return useContext(ShellMessagesContext);
}

export function ShellMessagesProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ShellMessage[]>([]);
  const pathname = usePathname();
  const seqRef = useRef(0);
  // The pathname this state was last aged against. A ref, not state: it is
  // read inside an effect and must not itself cause a render.
  const lastPathRef = useRef<string | null>(null);

  // Hydrate once, from the navigation that has just happened. Messages pushed
  // before a redirect live here across it -- which is the entire feature.
  useEffect(() => {
    try {
      setMessages(parseMessages(sessionStorage.getItem(SHELL_MESSAGES_KEY)));
    } catch {
      // A private window, or storage disabled. An empty region is correct;
      // a crash in the shell over a receipt would not be.
    }
    lastPathRef.current = window.location.pathname;
  }, []);

  // Age them on every real route change. The FIRST navigation after a push is
  // the one the save itself caused, so the message survives it; the second is
  // the user moving on, and it clears.
  useEffect(() => {
    if (lastPathRef.current === null || lastPathRef.current === pathname) {
      lastPathRef.current = pathname;
      return;
    }
    lastPathRef.current = pathname;
    setMessages((prev) => (prev.length === 0 ? prev : advanceNavigation(prev)));
  }, [pathname]);

  // Persist after every change, so the next route has them.
  useEffect(() => {
    try {
      sessionStorage.setItem(SHELL_MESSAGES_KEY, serialiseMessages(messages));
    } catch {}
  }, [messages]);

  const push = useCallback((message: ShellMessageInput) => {
    seqRef.current += 1;
    const id = `sm${Date.now().toString(36)}-${seqRef.current}`;
    setMessages((prev) => appendMessage(prev, { ...message, id, at: Date.now(), navs: 0 }));
  }, []);

  const dismiss = useCallback((id: string) => {
    setMessages((prev) => removeMessage(prev, id));
  }, []);

  const clear = useCallback(() => setMessages([]), []);

  const value = useMemo<ShellMessagesApi>(() => ({ messages, push, dismiss, clear }), [messages, push, dismiss, clear]);

  return <ShellMessagesContext.Provider value={value}>{children}</ShellMessagesContext.Provider>;
}

const GLYPH: Readonly<Record<ShellMessageKind, { char: string; colour: string }>> = {
  saved: { char: "✓", colour: "var(--color-veri-status-done)" },
  error: { char: "●", colour: "var(--color-veri-status-late)" },
  info: { char: "○", colour: "var(--color-ct-muted)" },
};

/**
 * The region itself -- rendered by M24Shell directly above the composer.
 *
 * It renders NOTHING when there is nothing to say. An empty bar reserving
 * space above the composer would cost the input band real height on a phone
 * for a message that is not there.
 */
export function ShellMessageRegion({ onOpen }: { onOpen?: (href: string) => void }) {
  const { messages, dismiss } = useShellMessages();
  const groups = useMemo(() => groupMessages(messages), [messages]);
  if (messages.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Recent saves and failures"
      className="pointer-events-auto mb-1 flex flex-col gap-1 rounded-lg border px-3 py-1.5"
      style={{ background: "#fff", borderColor: "var(--color-ct-border2)" }}
    >
      {groups.map((group) => (
        <div key={group.kind} className="flex flex-col gap-0.5">
          {group.label && (
            <p className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-ct-muted)" }}>
              {group.label}
            </p>
          )}
          {group.messages.map((m) => (
            <p key={m.id} className="flex flex-wrap items-center gap-2 text-[12px]">
              {/* GLYPH PLUS WORDS. The glyph never carries the meaning alone. */}
              <span aria-hidden style={{ color: GLYPH[m.kind].colour }}>
                {GLYPH[m.kind].char}
              </span>
              <span style={{ color: "var(--color-ct-navy)" }}>{m.text}</span>
              {m.href && (
                <button
                  type="button"
                  className="veri-view-tab"
                  onClick={() => onOpen?.(m.href!)}
                  aria-label={`${m.linkLabel ?? "Open"}: ${m.text}`}
                >
                  {m.linkLabel ?? "Open"}
                </button>
              )}
              {m.retry && (
                <button type="button" className="veri-view-tab" onClick={m.retry}>
                  Try again
                </button>
              )}
              <button
                type="button"
                className="veri-view-tab"
                onClick={() => dismiss(m.id)}
                aria-label={`Dismiss: ${m.text}`}
              >
                Dismiss
              </button>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
