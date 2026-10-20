/// <reference types="bun-types" />
// Live audit 2026-10-20 (R-80/R-81): the two AI pills ended as a bare red "error" in Recent Construction Queries, the stored
// error_message never shown. Real row: "The test AI is offline: the owner's laptop worker is not running. ..." (assistant_queries).
import { describe, expect, test } from "bun:test";
import { historyEntryView } from "./copilot-history";

describe("historyEntryView", () => {
  test("done stays done, no reason", () => {
    expect(historyEntryView({ status: "done", error_message: null })).toEqual({ label: "done", variant: "default", reason: null });
  });
  test("a real failure keeps the red badge and shows the stored words", () => {
    const v = historyEntryView({ status: "error", error_message: "The construction data service did not respond in time. Please retry." });
    expect(v).toEqual({ label: "error", variant: "destructive", reason: "The construction data service did not respond in time. Please retry." });
  });
  test("an AI that is switched off or offline is 'AI unavailable' with one plain sentence, never a red error", () => {
    const offline = historyEntryView({ status: "error", error_message: "The test AI is offline: the owner's laptop worker is not running. Start it, or switch AI_BRIDGE off." });
    expect(offline.label).toBe("AI unavailable");
    expect(offline.variant).toBe("secondary");
    expect(offline.reason).toBe("The AI behind this button is not running right now, so it could not answer. The other buttons still work.");
    const off = historyEntryView({ status: "error", error_message: "PROJEXA does not run its own AI. Open your own AI assistant and paste your PROJEXA AI link. The buttons and menus still work." });
    expect(off.label).toBe("AI unavailable");
  });
  test("an error with no stored message still says something", () => {
    expect(historyEntryView({ status: "error", error_message: null }).reason).toBe("No reason was recorded for this failure.");
  });
});
