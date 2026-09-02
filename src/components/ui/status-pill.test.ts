import { describe, expect, test } from "bun:test";
import { STATUS_MAP, TONE_STYLE, isSemanticStatus, toSemanticStatus, type SemanticStatus } from "./status-pill";

// R67 WS-G. These assert the RULES, not the pixels -- the map is the
// enforcement mechanism, so the map is what is tested.

describe("the single status map (R-260)", () => {
  test("covers exactly the ten statuses R-260 names, plus the two M24 tones", () => {
    expect(Object.keys(STATUS_MAP).sort()).toEqual(
      [
        "active",
        "blocked",
        "current",
        "done",
        "draft",
        "inactive",
        "late",
        "needs-you",
        "published",
        "running",
        "superseded",
        "waiting",
      ].sort()
    );
  });

  test("every status carries a non-empty word", () => {
    for (const [status, entry] of Object.entries(STATUS_MAP)) {
      expect(entry.word.trim().length).toBeGreaterThan(0);
      expect(entry.word).toBe(entry.word.trim());
      expect(status.length).toBeGreaterThan(0);
    }
  });

  test("every status resolves to a tone that has a glyph", () => {
    for (const entry of Object.values(STATUS_MAP)) {
      const tone = TONE_STYLE[entry.tone];
      expect(tone).toBeDefined();
      expect(tone.glyphKey.length).toBeGreaterThan(0);
      // lucide-react icons are forwardRef objects, not bare functions.
      expect(tone.icon).toBeTruthy();
      expect(["function", "object"]).toContain(typeof tone.icon);
    }
  });

  test("each tone has its own distinct glyph key", () => {
    const keys = Object.values(TONE_STYLE).map((t) => t.glyphKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("each tone draws a distinct SHAPE, not just a distinct key", () => {
    // The key test above passes vacuously if two tones share one icon, and
    // that is exactly what happened: 'needs-you' and 'neutral' both drew a
    // plain lucide Circle, so on the permits list "-" (no expiry date) and
    // "expires in 12 days" carried an identical mark. The word still
    // separated them, but the SECOND, non-colour cue this component exists
    // for was not there. needs-you is now CircleDot -- a filled centre,
    // because it is asking for something -- against neutral's empty outline.
    const icons = Object.values(TONE_STYLE).map((t) => t.icon);
    expect(icons.length).toBe(6);
    expect(new Set(icons).size).toBe(icons.length);
    expect(TONE_STYLE["needs-you"].icon).not.toBe(TONE_STYLE.neutral.icon);
  });

  test("every tone paints from a CSS custom property, never a literal hex", () => {
    // A literal here would be a colour that globals.css does not know about,
    // which means dark mode would not follow it.
    for (const tone of Object.values(TONE_STYLE)) {
      expect(tone.colorVar).toMatch(/^var\(--status-[a-z-]+-text\)$/);
    }
  });
});

describe("rose is reserved for late and error", () => {
  test("only 'late' and 'blocked' get the late tone", () => {
    const rose = (Object.keys(STATUS_MAP) as SemanticStatus[]).filter((s) => STATUS_MAP[s].tone === "late");
    expect(rose.sort()).toEqual(["blocked", "late"]);
  });

  test("superseded is grey, not red -- the specific defect R-260 names", () => {
    expect(STATUS_MAP.superseded.tone).toBe("neutral");
    expect(STATUS_MAP.superseded.word).toBe("superseded");
  });

  test("draft and inactive are grey too", () => {
    expect(STATUS_MAP.draft.tone).toBe("neutral");
    expect(STATUS_MAP.inactive.tone).toBe("neutral");
  });

  test("published, current and active are sage, not saffron", () => {
    // R-260: "remove [saffron] from the active Task Master tab tint, from
    // 'published' and 'active' pills and from KPI accents". No tone in this
    // component can be saffron, so this asserts they landed on 'done'.
    expect(STATUS_MAP.published.tone).toBe("done");
    expect(STATUS_MAP.current.tone).toBe("done");
    expect(STATUS_MAP.active.tone).toBe("done");
  });

  test("no tone is the brand saffron", () => {
    for (const tone of Object.values(TONE_STYLE)) {
      expect(tone.colorVar).not.toContain("saffron");
      expect(tone.colorVar).not.toContain("brand");
      expect(tone.colorVar).not.toContain("primary");
    }
  });
});

describe("toSemanticStatus normalises what the backends really send", () => {
  test("accepts the underscore and casing variants seen on live rows", () => {
    expect(toSemanticStatus("needs_you")).toBe("needs-you");
    expect(toSemanticStatus("SUPERSEDED")).toBe("superseded");
    expect(toSemanticStatus("  Published ")).toBe("published");
    expect(toSemanticStatus("needs you")).toBe("needs-you");
  });

  test("returns null for anything it does not know, rather than guessing", () => {
    expect(toSemanticStatus("half_day")).toBeNull();
    expect(toSemanticStatus("")).toBeNull();
    expect(toSemanticStatus(null)).toBeNull();
    expect(toSemanticStatus(undefined)).toBeNull();
  });

  test("isSemanticStatus agrees with the map", () => {
    expect(isSemanticStatus("done")).toBe(true);
    expect(isSemanticStatus("exploded")).toBe(false);
  });
});
