"use client";

// R67 E-10 (R-133). THE SHELL'S PERSISTENT MESSAGE AREA.
//
// The Reports screen used to report a failed run with toast.error(). A toast
// is not a message area: it disappears on a timer, so the one sentence that
// says what went wrong is gone by the time the reader looks up, and the screen
// underneath says nothing. R-133's rule is that a failure lives somewhere that
// never vanishes.
//
// This is that place. A screen publishes ONE message under its own key -- a
// re-run replaces the previous one rather than stacking a second copy of the
// same failure -- and clears it by publishing null. The strip renders at the
// bottom of the right pane, sticks there while the page scrolls, and is
// dismissible by the reader (who has read it), never by a timer.
//
// It is deliberately NOT the Task Master pane's shellErrors box: that box is
// about the SHELL's own degraded reads (organisation, projects, tasks), and
// merging the two would make a page's error look like a platform failure.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Info, X } from "lucide-react";

export type ShellMessageTone = "error" | "info";
export type ShellMessage = { key: string; tone: ShellMessageTone; text: string };

type ShellMessageApi = {
  messages: ShellMessage[];
  /** Publish (or, with null, withdraw) the message this key owns. */
  publish: (key: string, message: { tone: ShellMessageTone; text: string } | null) => void;
};

const ShellMessageContext = createContext<ShellMessageApi | null>(null);

export function ShellMessageProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ShellMessage[]>([]);

  const publish = useCallback((key: string, message: { tone: ShellMessageTone; text: string } | null) => {
    setMessages((prev) => {
      const without = prev.filter((m) => m.key !== key);
      if (!message) return without.length === prev.length ? prev : without;
      const existing = prev.find((m) => m.key === key);
      // Publishing the same sentence twice must not re-render the strip: a
      // message that flickers reads as a new failure.
      if (existing && existing.text === message.text && existing.tone === message.tone) return prev;
      return [...without, { key, ...message }];
    });
  }, []);

  const value = useMemo(() => ({ messages, publish }), [messages, publish]);
  return <ShellMessageContext.Provider value={value}>{children}</ShellMessageContext.Provider>;
}

/**
 * Safe outside the shell: a screen rendered in a test, or on a route with no
 * shell, gets a no-op rather than a crash. A message with nowhere to go is a
 * missing message area, not a broken screen.
 */
export function useShellMessages(): ShellMessageApi {
  const ctx = useContext(ShellMessageContext);
  return ctx ?? { messages: [], publish: () => {} };
}

/**
 * Declarative publisher: a screen states what its message IS right now, and
 * this keeps the strip in step -- including withdrawing it when the screen
 * unmounts, so a report error cannot outlive the screen that produced it.
 */
export function useShellMessage(key: string, message: { tone: ShellMessageTone; text: string } | null) {
  const { publish } = useShellMessages();
  const tone = message?.tone ?? null;
  const text = message?.text ?? null;
  useEffect(() => {
    publish(key, text ? { tone: (tone ?? "info") as ShellMessageTone, text } : null);
    return () => publish(key, null);
  }, [key, tone, text, publish]);
}

export function ShellMessageStrip() {
  const { messages, publish } = useShellMessages();
  if (messages.length === 0) return null;
  return (
    <div className="sticky bottom-0 z-10 space-y-1 p-2" data-testid="shell-message-strip">
      {messages.map((m) => (
        <div
          key={m.key}
          role={m.tone === "error" ? "alert" : "status"}
          className="flex items-start gap-2 rounded-lg border bg-white p-3 text-[12.5px] shadow-card"
          style={{ borderColor: m.tone === "error" ? "var(--px-error-border, var(--color-ct-border))" : "var(--color-ct-border)" }}
        >
          {m.tone === "error" ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: "var(--status-late-text)" }} />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" style={{ color: "var(--color-ct-muted)" }} />
          )}
          <p className="flex-1" style={{ color: m.tone === "error" ? "var(--status-late-text)" : "var(--color-ct-navy)" }}>{m.text}</p>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => publish(m.key, null)}
            className="cursor-pointer"
            style={{ color: "var(--color-ct-muted)" }}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
