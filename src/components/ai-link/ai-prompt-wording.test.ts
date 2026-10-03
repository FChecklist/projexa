import { describe, expect, test } from "bun:test";
import { mock } from "bun:test";

// The wording is tested against real outside AIs (scripts/verify/ai-link/simulate-external-ai.mjs in
// compliance-tracker): "open this link and follow it" was refused by a careful AI as a possible
// prompt-injection about one run in three, while framing the link as the owner's own API documentation
// was followed 3 times out of 3. These tests pin the properties that made the difference.
mock.module("next/navigation", () => ({ useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
const { buildAiPrompt, buildUserPrompt } = await import("./AiWorkLinkCompact");

const LINK = "https://x.supabase.co/functions/v1/ai-work-link/pxa_abc";

describe("the pasted AI prompt", () => {
  test("presents the link as documentation for the person's own software, not as instructions to obey", () => {
    for (const text of [buildUserPrompt(LINK), buildAiPrompt(LINK, undefined)]) {
      expect(text).toContain(LINK);
      expect(text).toMatch(/documentation for you to read/i);
      expect(text).toMatch(/my own company's software/i);
      expect(text).toMatch(/draft changes that I confirm myself/i);
      expect(text).not.toMatch(/follow it and work on my behalf/i);
    }
  });

  test("the user-wide prompt asks for the numbered project list with the two closing options, then waits", () => {
    const text = buildUserPrompt(LINK);
    expect(text).toMatch(/numbered list of ALL my projects/);
    expect(text).toMatch(/"Report on all above" as the second-to-last option/);
    expect(text).toMatch(/"Create New Project" as the last option/);
    expect(text).toMatch(/wait for my choice/i);
  });

  test("it never says VERIDIAN", () => {
    expect(buildUserPrompt(LINK)).not.toMatch(/veridian/i);
    expect(buildAiPrompt(LINK, "Budgets")).not.toMatch(/veridian/i);
  });
});
