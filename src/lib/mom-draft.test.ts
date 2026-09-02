/// <reference types="bun-types" />
// R67 lane D22 (item D-58). Covers the two pure decisions -- "is this draft
// worth offering back" and "what time does the indicator read" -- plus the
// round trip through a stubbed localStorage, including the shapes a corrupted
// or hand-edited storage entry can really take.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearMoMDraft, draftHasContent, draftSavedAtLabel, loadMoMDraft, saveMoMDraft } from "./mom-draft";

const EMPTY = { title: "", scheduledAt: "", attendees: [], agenda: [], minutes: "", actionItems: [] };

describe("draftHasContent", () => {
  test("an untouched form is not a draft worth restoring", () => {
    expect(draftHasContent(EMPTY)).toBe(false);
    expect(draftHasContent({ ...EMPTY, title: "   ", minutes: "  ", agenda: ["  "] })).toBe(false);
  });

  test("any real content makes it restorable -- minutes above all", () => {
    expect(draftHasContent({ ...EMPTY, minutes: "Crew reported 40 m3 poured" })).toBe(true);
    expect(draftHasContent({ ...EMPTY, title: "Weekly coordination" })).toBe(true);
    expect(draftHasContent({ ...EMPTY, attendees: ["Arjun Mehta"] })).toBe(true);
    expect(draftHasContent({ ...EMPTY, agenda: ["Programme"] })).toBe(true);
    expect(draftHasContent({ ...EMPTY, actionItems: [{ title: "Close RFI-12", assigneeUserId: null, assigneeName: null, dueDate: "" }] })).toBe(true);
  });

  test("an action-item row with no description is the form's resting state, not content", () => {
    expect(draftHasContent({ ...EMPTY, actionItems: [{ title: "", assigneeUserId: "usr_1", assigneeName: "A", dueDate: "" }] })).toBe(false);
  });
});

describe("draftSavedAtLabel", () => {
  test("reads as a zero-padded 24h clock time", () => {
    const d = new Date(2026, 8, 2, 10, 42, 0);
    expect(draftSavedAtLabel(d.toISOString())).toBe("10:42");
    expect(draftSavedAtLabel(new Date(2026, 8, 2, 9, 5, 0).toISOString())).toBe("09:05");
  });

  test("an absent or unreadable timestamp has no label rather than a wrong one", () => {
    expect(draftSavedAtLabel(null)).toBeNull();
    expect(draftSavedAtLabel(undefined)).toBeNull();
    expect(draftSavedAtLabel("not a date")).toBeNull();
  });
});

describe("draft storage", () => {
  const store = new Map<string, string>();
  const original = (globalThis as { localStorage?: Storage }).localStorage;

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      } as unknown as Storage,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  });

  test("round-trips a draft and stamps it with a save time", () => {
    const savedAt = saveMoMDraft("proj_1", { ...EMPTY, title: "Weekly", minutes: "notes" });
    expect(savedAt).not.toBeNull();
    const loaded = loadMoMDraft("proj_1");
    expect(loaded?.title).toBe("Weekly");
    expect(loaded?.minutes).toBe("notes");
    expect(draftSavedAtLabel(loaded!.savedAt)).toMatch(/^\d{2}:\d{2}$/);
  });

  test("drafts are per project -- one project's minutes never overwrite another's", () => {
    saveMoMDraft("proj_1", { ...EMPTY, minutes: "tower A" });
    saveMoMDraft("proj_2", { ...EMPTY, minutes: "tower B" });
    expect(loadMoMDraft("proj_1")?.minutes).toBe("tower A");
    expect(loadMoMDraft("proj_2")?.minutes).toBe("tower B");
  });

  test("a corrupted entry loads as no draft rather than throwing mid-meeting", () => {
    store.set("veri.mom.draft.proj_1", "{ not json");
    expect(loadMoMDraft("proj_1")).toBeNull();
    store.set("veri.mom.draft.proj_1", JSON.stringify({ title: 7, attendees: "nope", actionItems: [{}] }));
    const loaded = loadMoMDraft("proj_1");
    expect(loaded?.title).toBe("");
    expect(loaded?.attendees).toEqual([]);
    expect(loaded?.actionItems).toEqual([{ title: "", assigneeUserId: null, assigneeName: null, dueDate: "" }]);
  });

  test("clearing removes it", () => {
    saveMoMDraft("proj_1", { ...EMPTY, minutes: "x" });
    clearMoMDraft("proj_1");
    expect(loadMoMDraft("proj_1")).toBeNull();
  });

  test("no draft for a project that never had one", () => {
    expect(loadMoMDraft("proj_never")).toBeNull();
  });
});
