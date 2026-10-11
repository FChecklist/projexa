/// <reference types="bun-types" />
// "Did it work?" for the website way (owner order 2026-10-11: mistakes identified and told to the person). Pure functions of the person's link rows.
// Falsifiability: make diagnoseConnection answer "connected" for any link that exists, or ignore madeAfter, and the waiting/old-use cases fail.
import { describe, expect, test } from "bun:test";
import { agoWords, currentCode, diagnoseConnection } from "./connection-check";
import { CONNECT_PROVIDERS, checkKeyFormat } from "./connect-your-ai-providers";
import type { AwlLinkRow } from "@/lib/ai-work-link-core";

const NOW = new Date("2026-10-11T12:00:00Z");
const row = (over: Partial<AwlLinkRow> = {}): AwlLinkRow => ({
  id: "l1", scope: "user", projectId: "", projectName: null, label: "ChatGPT connection", level: 1,
  createdAt: "2026-10-11T11:50:00Z", expiresAt: "2026-11-10T11:50:00Z", revokedAt: null, lastUsedAt: null, status: "active", ...over,
});
const MISTAKES = ["m1", "m2"];

describe("diagnoseConnection", () => {
  test("could not read the list: says so and asks to check the internet", () => {
    const d = diagnoseConnection(null, null, NOW, "ChatGPT", MISTAKES);
    expect(d.state).toBe("unreachable");
    expect(d.detail).toContain("internet");
  });
  test("no code at all: says to make one first", () => {
    expect(diagnoseConnection([], null, NOW, "ChatGPT", MISTAKES).state).toBe("no-code");
    expect(diagnoseConnection([row({ scope: "project" })], null, NOW, "ChatGPT", MISTAKES).state).toBe("no-code");
  });
  test("expired or switched-off code: says to make a new one and paste the NEW address", () => {
    const d = diagnoseConnection([row({ status: "expired" })], null, NOW, "ChatGPT", MISTAKES);
    expect(d.state).toBe("expired");
    expect(d.detail).toContain("NEW address");
    expect(diagnoseConnection([row({ revokedAt: "2026-10-11T11:55:00Z", status: "revoked" })], null, NOW, "ChatGPT", MISTAKES).state).toBe("no-code");
  });
  test("code made, AI has not used it: waiting, with that AI's usual mistakes listed", () => {
    const d = diagnoseConnection([row()], "2026-10-11T11:50:00Z", NOW, "Grok", MISTAKES);
    expect(d.state).toBe("waiting");
    if (d.state !== "waiting") throw new Error("unreachable");
    expect(d.title).toContain("Grok has not used your code");
    expect(d.tryThese).toEqual(MISTAKES);
    expect(d.detail).toContain("NEW chat");
  });
  test("used AFTER the code was made here: connected, with how long ago", () => {
    const d = diagnoseConnection([row({ lastUsedAt: "2026-10-11T11:58:00Z" })], "2026-10-11T11:50:00Z", NOW, "ChatGPT", MISTAKES);
    expect(d.state).toBe("connected");
    expect(d.title).toBe("Connected. ChatGPT used PROJEXA 2 minutes ago.");
  });
  test("an OLD use from before this code was made here does not count as connected", () => {
    const d = diagnoseConnection([row({ lastUsedAt: "2026-10-10T09:00:00Z" })], "2026-10-11T11:50:00Z", NOW, "ChatGPT", MISTAKES);
    expect(d.state).toBe("waiting");
  });
  test("opened the panel without making a code now: a code that was used is shown as connected with its last use", () => {
    const d = diagnoseConnection([row({ lastUsedAt: "2026-10-11T09:00:00Z" })], null, NOW, "Claude", MISTAKES);
    expect(d.state).toBe("connected");
    expect(d.title).toContain("3 hours ago");
  });
  test("the current code is the newest not-revoked all-projects link", () => {
    const newer = row({ id: "new", createdAt: "2026-10-11T11:59:00Z" });
    expect(currentCode([row({ id: "old" }), newer])?.id).toBe("new");
  });
  test("agoWords", () => {
    expect(agoWords("2026-10-11T11:59:50Z", NOW)).toBe("just now");
    expect(agoWords("2026-10-11T11:59:00Z", NOW)).toBe("1 minute ago");
    expect(agoWords("2026-10-09T12:00:00Z", NOW)).toBe("2 days ago");
  });
});

describe("the AI cards", () => {
  test("are in the owner's order, Claude and Others after the six", () => {
    expect(CONNECT_PROVIDERS.map((p) => p.name)).toEqual(["ChatGPT", "Gemini", "Copilot", "Grok", "DeepSeek", "z.ai", "Claude", "Others"]);
  });
  test("every card tells the truth about its website: a way to connect, or an honest 'cannot' with what to do instead", () => {
    for (const p of CONNECT_PROVIDERS) {
      expect(p.website.supportNote.length).toBeGreaterThan(30);
      expect(p.website.ifMissing.length).toBeGreaterThan(20);
      if (p.website.support === "no" && p.website.steps.length === 0) expect(p.website.instead).toBeTruthy();
      if (p.website.steps.length > 0) expect(p.website.mistakes.length).toBeGreaterThanOrEqual(3);
    }
    const by = Object.fromEntries(CONNECT_PROVIDERS.map((p) => [p.id, p]));
    expect(by.copilot!.website.support).toBe("no");
    expect(by.deepseek!.website.support).toBe("no");
    expect(by.grok!.website.support).toBe("works"); // xAI: "available to all Grok users"
    expect(by.chatgpt!.website.supportNote).toContain("Business, Enterprise and Edu");
    expect(by.gemini!.website.supportNote).toContain("Ultra");
    expect(by.copilot!.ownKey).toBeNull();
    expect(by.grok!.maker).toBe("xAI");
  });
  test("steps never promise a menu name we could not confirm without saying where else to look", () => {
    for (const p of CONNECT_PROVIDERS) if (p.website.steps.length > 0) expect(p.website.ifMissing).toMatch(/cannot|means|If you/i);
  });
});

describe("checkKeyFormat (mistakes caught before anything is sent)", () => {
  test.each([
    ["openai", "", /Paste your key first/],
    ["openai", "sk-abc def ghi jkl mno pqr stu", /space or a line break/],
    ["openai", "https://example.com/functions/v1/ai-work-link/pxa_abc", /web address, not a key/],
    ["openai", "someone@example.com", /email address/],
    ["openai", "sk-ant-abcdefghijklmnopqrstuvwxyz", /Claude \(Anthropic\) key/],
    ["anthropic", "sk-or-abcdefghijklmnopqrstuvwxyz", /OpenRouter key/],
    ["openrouter", "gsk_abcdefghijklmnopqrstuvwxyz", /Groq key/],
    ["openai", "AIzaabcdefghijklmnopqrstuvwxyz", /Gemini \(Google\) key/],
    ["deepseek", "xai-abcdefghijklmnopqrstuvwxyz", /Grok \(xAI\) key/],
    ["openai", "mypasswordisverylongandsafe123", /start with sk-/],
    ["openai", "sk-short", /too short/],
  ])("%s: %s", (vendor, key, expected) => {
    expect(checkKeyFormat(vendor as never, key)).toMatch(expected);
  });
  test("a key of the right shape for its company passes", () => {
    expect(checkKeyFormat("openai", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789")).toBeNull();
    expect(checkKeyFormat("anthropic", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789")).toBeNull();
    expect(checkKeyFormat("google", "AIzaSyabcdefghijklmnopqrstuvwxyz012345678")).toBeNull();
    expect(checkKeyFormat("openrouter", "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789")).toBeNull();
  });
});
