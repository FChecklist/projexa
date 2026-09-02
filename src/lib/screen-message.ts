"use client";

// R67 D-05/D-06. A receipt has to survive the navigation that follows it.
//
// The rule these screens are being held to is "errors and receipts live in
// the screen's own persistent message band, never in a toast" (the kit's
// MessageArea comment: "toasts vanish; errors must persist until resolved").
// But the moment a create or a delete succeeds, the screen that knows about
// it is replaced -- the permit object page pushes back to the list, the
// create screen pushes to the object page -- so the message has to be handed
// from the screen that produced it to the screen that renders it.
//
// sessionStorage, not a query parameter: the acceptance for these items
// checks the landing URL exactly (`/permits?projectId=<id>`), and a message
// is not part of a screen's address -- it must not survive a reload, a
// bookmark, or a shared link. Every access is wrapped because sessionStorage
// throws outright in some privacy modes; a lost receipt must never take the
// screen down with it.
//
// Read-and-clear ("take") on purpose: a receipt is shown once. Coming back to
// the same list later must not re-announce a deletion from ten minutes ago.

export type ScreenMessageLevel = "error" | "warning" | "success" | "info";

export type ScreenMessage = { level: ScreenMessageLevel; text: string };

const PREFIX = "veri.screen.message:";

/** Queue a message for the NEXT screen keyed by `key` (e.g. "permits.list"). */
export function setScreenMessage(key: string, message: ScreenMessage): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(message));
  } catch {
    // Storage unavailable (private browsing, storage disabled). The receipt
    // is a courtesy; the write it reports already happened.
  }
}

/**
 * Read and remove the queued message for `key`. Returns null when there is
 * none, when storage is unavailable, or when what was stored is not a
 * message -- a corrupted entry must not render as "[object Object]".
 */
export function takeScreenMessage(key: string): ScreenMessage | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    window.sessionStorage.removeItem(PREFIX + key);
    return parseScreenMessage(raw);
  } catch {
    return null;
  }
}

/** Exported for its own test: the shape check `takeScreenMessage` applies. */
export function parseScreenMessage(raw: string): ScreenMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { level, text } = parsed as { level?: unknown; text?: unknown };
  if (typeof text !== "string" || !text) return null;
  if (level !== "error" && level !== "warning" && level !== "success" && level !== "info") return null;
  return { level, text };
}
