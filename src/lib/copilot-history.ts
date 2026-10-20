// Recent Construction Queries (CopilotClient): how one stored assistant_queries row is shown. Errors are never opaque: the stored
// error_message is always surfaced, and a failure that only means "the AI is not running" is shown as a calm "AI unavailable" with one
// plain sentence instead of a red "error" (Sumeet R-81: no visible pill may look broken).

export type HistoryView = { label: string; variant: "default" | "secondary" | "destructive"; reason: string | null };

const AI_UNAVAILABLE = /test AI is offline|does not run its own AI|AI_BRIDGE|own AI assistant/i;
export const AI_UNAVAILABLE_SENTENCE = "The AI behind this button is not running right now, so it could not answer. The other buttons still work.";

export function historyEntryView(q: { status: string; error_message: string | null }): HistoryView {
  if (q.status === "done") return { label: "done", variant: "default", reason: null };
  if (q.status !== "error") return { label: q.status, variant: "secondary", reason: null };
  const message = q.error_message?.trim() ?? "";
  if (AI_UNAVAILABLE.test(message)) return { label: "AI unavailable", variant: "secondary", reason: AI_UNAVAILABLE_SENTENCE };
  return { label: "error", variant: "destructive", reason: message || "No reason was recorded for this failure." };
}
