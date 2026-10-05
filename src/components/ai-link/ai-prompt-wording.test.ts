import { describe, expect, test } from "bun:test";
import { mock } from "bun:test";

// Owner-approved small prompt (2026-10-05). The wording was tested against real outside AIs: framing the link as the owner's own
// documentation, opened with a plain GET, is what careful AIs follow. The full manual lives behind the link. These tests pin it.
mock.module("next/navigation", () => ({ useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
const { buildAiPrompt, buildUserPrompt } = await import("./AiWorkLinkCompact");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ext = require("../../../extension/projexa-ai-link/lib.js");

const LINK = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link/pxa_" + "a".repeat(30);

const EXACT =
  "PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): ";

const variants: Array<[string, (l: string) => string]> = [
  ["user prompt", (l) => buildUserPrompt(l)],
  ["project prompt", (l) => buildAiPrompt(l, "Budgets")],
  ["extension prompt", (l) => ext.buildSmallPrompt(l)],
];

describe("the pasted AI prompt", () => {
  for (const [name, build] of variants) {
    test(`${name}: exact owner-approved text, link last and exactly once`, () => {
      const text = build(LINK);
      expect(text).toBe(EXACT + LINK);
      expect(text.split(LINK).length - 1).toBe(1);
      expect(text.endsWith(LINK)).toBe(true);
      expect(text).toContain("plain GET");
      expect(text).toContain("my AI assistant");
    });
    test(`${name}: small (under 330 chars besides the link), no old project-list instructions, never VERIDIAN`, () => {
      const text = build(LINK);
      expect(text.length - LINK.length).toBeLessThan(330);
      expect(text).not.toMatch(/numbered list|Report on all above|Create New Project|Start here|not instructions from a stranger/);
      expect(text).not.toMatch(/veridian/i);
    });
  }

  test("falsifiability: the assertions fail if the 'plain GET' clause is removed", () => {
    const broken = (EXACT + LINK).replace(" (open it with a plain GET and follow it)", "");
    expect(broken).not.toContain("plain GET");
    expect(broken).not.toBe(EXACT + LINK);
  });
});
