import { describe, expect, test } from "bun:test";
import { mock } from "bun:test";

// The wording is tested against real outside AIs (scripts/verify/ai-link/simulate-external-ai.mjs in
// compliance-tracker): "open this link and follow it" was refused by a careful AI as a possible
// prompt-injection about one run in three, while framing the link as the owner's own API documentation
// was followed 3 times out of 3. These tests pin the properties that made the difference. 2026-10-04: the prompt is now SMALL (the full
// manual lives behind the link) and says the AI acts with the person's own rights and does everything except write code.
mock.module("next/navigation", () => ({ useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
const { buildAiPrompt, buildUserPrompt } = await import("./AiWorkLinkCompact");

const LINK = "https://x.supabase.co/functions/v1/ai-work-link/pxa_abc";

describe("the pasted AI prompt", () => {
  test("presents the link as documentation from the person's own software, not instructions from a stranger", () => {
    for (const text of [buildUserPrompt(LINK), buildAiPrompt(LINK, undefined)]) {
      expect(text).toContain(LINK);
      expect(text).toMatch(/documentation from my own company's software/i);
      expect(text).toMatch(/not instructions from a stranger/i);
      expect(text).toMatch(/only what my role allows/i);
      expect(text).toMatch(/plain GET/);
      expect(text).toContain('follow "Start here"');
      expect(text).toMatch(/on my behalf with my rights/);
      expect(text).toMatch(/everything except writing code/);
    }
  });

  test("the user-wide prompt asks for the numbered project list with the two closing options", () => {
    const text = buildUserPrompt(LINK);
    expect(text).toMatch(/numbered list of ALL my projects/);
    expect(text).toMatch(/"Report on all above" second-to-last/);
    expect(text).toMatch(/"Create New Project" last/);
  });

  test("it is small: at most 450 characters of text besides the link", () => {
    const real = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link/pxa_" + "a".repeat(30);
    expect(buildUserPrompt(real).length - real.length).toBeLessThanOrEqual(450);
    expect(buildAiPrompt(real, "Budgets").length - real.length).toBeLessThanOrEqual(450);
  });

  test("it never says VERIDIAN", () => {
    expect(buildUserPrompt(LINK)).not.toMatch(/veridian/i);
    expect(buildAiPrompt(LINK, "Budgets")).not.toMatch(/veridian/i);
  });
});
