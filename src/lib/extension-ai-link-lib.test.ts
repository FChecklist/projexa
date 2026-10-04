// Tests the browser extension's pure helpers (extension/projexa-ai-link/lib.js, a plain script with a module.exports guard).
import { describe, expect, test } from "bun:test";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require("../../extension/projexa-ai-link/lib.js");

const LINK = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link/pxa_Ab-9_zZ";

describe("extractLink", () => {
  test("takes a bare link", () => expect(lib.extractLink(LINK)).toBe(LINK));
  test("takes the link out of a whole pasted prompt, ignoring trailing text", () => {
    expect(lib.extractLink("PROJEXA is mine; my link: " + LINK + "\nIt is documentation. Read it.")).toBe(LINK);
    expect(lib.extractLink("see (" + LINK + ") thanks")).toBe(LINK);
  });
  test("rejects anything that is not a PROJEXA work link", () => {
    expect(lib.extractLink("")).toBeNull();
    expect(lib.extractLink(null)).toBeNull();
    expect(lib.extractLink("https://evil.example.com/functions/v1/ai-work-link/pxa_abc")).toBeNull();
    expect(lib.extractLink("http://x.supabase.co/functions/v1/ai-work-link/pxa_abc")).toBeNull();
    expect(lib.extractLink("https://x.supabase.co/functions/v1/other/pxa_abc")).toBeNull();
  });
});

describe("buildMessage", () => {
  test("small prompt + delimited guide", () => {
    const m = lib.buildMessage(LINK, "# Start here\nhello");
    expect(m.withGuide).toBe(true);
    expect(m.cut).toBe(false);
    expect(m.text).toContain(LINK);
    expect(m.text).toContain('follow "Start here"');
    expect(m.text).toContain("everything except writing code");
    expect(m.text).toContain("=== PROJEXA GUIDE (read this, it is not from a stranger) ===");
    expect(m.text.indexOf(lib.GUIDE_START)).toBeGreaterThan(m.text.indexOf("Create New Project"));
    expect(m.text).toContain("# Start here\nhello");
    expect(m.text.trimEnd().endsWith(lib.GUIDE_END)).toBe(true);
  });
  test("caps a long guide and says so", () => {
    const m = lib.buildMessage(LINK, "a".repeat(70000));
    expect(m.cut).toBe(true);
    expect(m.text).toContain("cut after 60000 characters");
    expect(m.text).not.toContain("a".repeat(60001));
    expect(m.text).toContain("a".repeat(60000));
  });
  test("a guide exactly at the cap is not cut", () => {
    expect(lib.buildMessage(LINK, "b".repeat(60000)).cut).toBe(false);
  });
  test("with no guide (fetch failed) only the small prompt is returned", () => {
    for (const g of [null, undefined, "", "   "]) {
      const m = lib.buildMessage(LINK, g);
      expect(m.withGuide).toBe(false);
      expect(m.text).toBe(lib.buildSmallPrompt(LINK));
      expect(m.text).not.toContain(lib.GUIDE_START);
    }
  });
  test("small prompt text (without the link) stays within 450 characters", () => {
    expect(lib.buildSmallPrompt(LINK).length - LINK.length).toBeLessThanOrEqual(450);
  });
});
