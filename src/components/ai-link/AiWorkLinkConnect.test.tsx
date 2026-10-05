/// <reference types="bun-types" />
// The Connect panel of the AI work link: derived addresses, one-tap copy, the honest notes, and no network call of its own.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AiWorkLinkConnect, connectUrls, AWL_CONNECT_FREE_PLAN_NOTE, AWL_CONNECT_PASSWORD_WARNING } = await import("./AiWorkLinkConnect");
const { AiWorkLinkCompact, buildUserPrompt } = await import("./AiWorkLinkCompact");
import type { AwlClient } from "@/lib/ai-work-link-client";

const LINK = "https://example.supabase.co/functions/v1/ai-work-link/pxa_token";

let clipboard: string[];
let fetchCalls: unknown[];
const realFetch = globalThis.fetch;
beforeEach(() => {
  clipboard = [];
  fetchCalls = [];
  Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => void clipboard.push(t) } });
  globalThis.fetch = ((...a: unknown[]) => {
    fetchCalls.push(a);
    throw new Error("no network allowed");
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("AiWorkLinkConnect", () => {
  test("derived addresses use the exact suffixes", () => {
    expect(connectUrls(LINK)).toEqual({ mcp: LINK, openapi: LINK + "/openapi.json", swagger: LINK + "/swagger.json" });
    expect(connectUrls(LINK + "/").openapi).toBe(LINK + "/openapi.json");
  });

  test("rows show the right addresses (openapi row ends in /openapi.json, swagger row in /swagger.json)", () => {
    render(<AiWorkLinkConnect link={LINK} />);
    expect(screen.getByTestId("awl-connect-value-mcp").textContent).toBe(LINK);
    expect(screen.getByTestId("awl-connect-value-openapi").textContent).toBe(LINK + "/openapi.json");
    expect(screen.getByTestId("awl-connect-value-swagger").textContent).toBe(LINK + "/swagger.json");
    expect(screen.getByTestId("awl-connect-value-openapi").textContent).not.toContain("swagger");
  });

  test("each copy button copies the right text and shows Copied", async () => {
    render(<AiWorkLinkConnect link={LINK} />);
    for (const [key, want] of [
      ["mcp", LINK],
      ["openapi", LINK + "/openapi.json"],
      ["swagger", LINK + "/swagger.json"],
      ["prompt", buildUserPrompt(LINK)],
    ] as const) {
      const btn = screen.getByTestId(`awl-connect-copy-${key}`);
      await act(async () => void fireEvent.click(btn));
      expect(clipboard[clipboard.length - 1]).toBe(want);
      expect(btn.textContent).toContain("Copied");
    }
  });

  test("the honest notes and the bold password warning are present; the per-AI steps are named", () => {
    render(<AiWorkLinkConnect link={LINK} />);
    expect(screen.getByTestId("awl-connect-free-note").textContent).toBe(AWL_CONNECT_FREE_PLAN_NOTE);
    expect(AWL_CONNECT_FREE_PLAN_NOTE).toBe("Some free AI plans do not allow connectors; then paste the prompt instead.");
    const w = screen.getByTestId("awl-connect-warning");
    expect(w.textContent).toBe(AWL_CONNECT_PASSWORD_WARNING);
    expect(w.textContent).toContain("Your link is your password. Never share it");
    expect(w.className).toContain("font-bold");
    const all = screen.getByTestId("awl-connect").textContent ?? "";
    for (const s of ["Add custom connector", "Developer mode", "import from URL", "Gemini", "Cursor", "Claude Code", "Gemini CLI", "DeepSeek", "z.ai", "Grok"]) expect(all).toContain(s);
  });

  test("the panel itself makes no network call", async () => {
    render(<AiWorkLinkConnect link={LINK} />);
    for (const key of ["mcp", "openapi", "swagger", "prompt"]) await act(async () => void fireEvent.click(screen.getByTestId(`awl-connect-copy-${key}`)));
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("Connect is reachable from the AI work link button", () => {
  const client = {
    async mintUserLink() {
      return { linkId: "l", level: 1, expiresAt: "x", label: null, project: null, link: LINK, inbox: null, notice: "", shell: false };
    },
  } as unknown as AwlClient;

  test("not shown before a link exists; after the first copy the Connect toggle opens the panel with the same link", async () => {
    render(<AiWorkLinkCompact role="owner" project={null} client={client} scope="user" triggerLabel="AI prompt" />);
    expect(screen.queryByTestId("awl-compact-connect-toggle")).toBeNull();
    await act(async () => void fireEvent.click(screen.getByTestId("awl-compact-trigger")));
    await act(async () => void fireEvent.click(await screen.findByTestId("awl-compact-connect-toggle")));
    expect(screen.getByTestId("awl-connect-value-openapi").textContent).toBe(LINK + "/openapi.json");
    expect(fetchCalls).toHaveLength(0);
  });
});
