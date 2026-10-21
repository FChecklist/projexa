// A save made on this laptop (queued, then sent or turned down by the server) is something the person DID, so it belongs in the project
// timeline as its own row ("Set a line budget -- worked / failed") exactly like a write sent straight to the server. Pure: the label lookup
// and the logger come in, so it is tested without the outbox or the browser.

import type { OutboxEvent } from "@/lib/local-first/outbox";

export function logOutboxEvent(
  event: OutboxEvent,
  deps: { labelOf: (functionId: string) => string | null | undefined; log: (name: string, outcome: "ok" | "failed") => void }
): void {
  try {
    if (event.type !== "applied" && event.type !== "rejected") return;
    const name = deps.labelOf(event.functionId)?.trim();
    if (!name) return;
    deps.log(name, event.type === "applied" ? "ok" : "failed");
  } catch {
    /* logging must never break the outbox */
  }
}
