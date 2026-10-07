/// <reference types="bun-types" />
// "Sign in with PROJEXA": the consent screen, rendered for real in happy-dom. The work-link client and the network are fakes that behave like
// the real contract (mintUserLink returns the link once; /approve answers {redirect}). What is pinned: a good request shows a plain question,
// Allow mints a 30-day link and hands ONLY the token to the sign-in service, then goes where the service says; a refusal by the service stays
// on the page with its sentence; "Not now" goes back with access_denied; a bad request shows nothing to approve.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const TOKEN = `pxa_${"cd34".repeat(16)}`;
const mintCalls: Array<{ days: number; label?: string; level?: number }> = [];
mock.module("@/lib/ai-work-link-client", () => ({
  getAwlClient: () => ({
    mintUserLink: async (input: { days: number; label?: string; level?: number }) => {
      mintCalls.push(input);
      return { link: `https://x.supabase.co/functions/v1/ai-work-link/${TOKEN}` };
    },
  }),
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ConnectAuthorizeClient } = await import("./ConnectAuthorizeClient");

const CHALLENGE = "a".repeat(43);
const REQUEST = { c: "px_" + "0f".repeat(12), r: "https://claude.ai/api/mcp/auth_callback", s: "st", h: CHALLENGE, n: "Claude" };
const payload = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

const nav: string[] = [];
const realFetch = globalThis.fetch;
let approveBody: Record<string, unknown> | null = null;

beforeEach(() => {
  mintCalls.length = 0;
  nav.length = 0;
  approveBody = null;
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign: (u: string) => nav.push(u) } });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function answer(status: number, body: unknown) {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    approveBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("the consent screen", () => {
  test("asks one plain question, in the AI tool's own name", () => {
    render(<ConnectAuthorizeClient payload={payload(REQUEST)} />);
    expect(screen.getByText("Let Claude use PROJEXA as you?")).toBeTruthy();
    expect(screen.getByText(/you confirm each change in PROJEXA/)).toBeTruthy();
    expect((screen.getByTestId("connect-direct") as HTMLInputElement).checked).toBe(false);
  });

  test("Allow mints a 30-day level-0 link (the person confirms each change), sends only the token to the service, then goes where the service says", async () => {
    answer(200, { redirect: "https://claude.ai/api/mcp/auth_callback?code=abc&state=st" });
    render(<ConnectAuthorizeClient payload={payload(REQUEST)} />);
    fireEvent.click(screen.getByTestId("connect-allow"));
    await waitFor(() => expect(nav).toEqual(["https://claude.ai/api/mcp/auth_callback?code=abc&state=st"]));
    expect(mintCalls).toEqual([{ days: 30, label: "Claude (sign-in)", level: 0 }]);
    expect(approveBody).toEqual({ client_id: REQUEST.c, redirect_uri: REQUEST.r, code_challenge: CHALLENGE, state: "st", link_token: TOKEN });
  });

  test("ticking the box is the only way to ask for direct changes (level 1)", async () => {
    answer(200, { redirect: "https://claude.ai/api/mcp/auth_callback?code=abc&state=st" });
    render(<ConnectAuthorizeClient payload={payload(REQUEST)} />);
    fireEvent.click(screen.getByTestId("connect-direct"));
    fireEvent.click(screen.getByTestId("connect-allow"));
    await waitFor(() => expect(nav.length).toBe(1));
    expect(mintCalls).toEqual([{ days: 30, label: "Claude (sign-in)", level: 1 }]);
  });

  test("a refusal by the service stays on the page and says why; nothing is followed", async () => {
    answer(400, { error: "invalid_request", error_description: "That link is not valid. Sign in to PROJEXA and try again." });
    render(<ConnectAuthorizeClient payload={payload(REQUEST)} />);
    fireEvent.click(screen.getByTestId("connect-allow"));
    await waitFor(() => expect(screen.getByTestId("connect-error").textContent).toContain("That link is not valid"));
    expect(nav).toEqual([]);
  });

  test("an unsafe redirect in the service's answer is never followed", async () => {
    answer(200, { redirect: "javascript:alert(1)" });
    render(<ConnectAuthorizeClient payload={payload(REQUEST)} />);
    fireEvent.click(screen.getByTestId("connect-allow"));
    await waitFor(() => expect(screen.getByTestId("connect-error")).toBeTruthy());
    expect(nav).toEqual([]);
  });

  test("Not now goes back with access_denied and the state, and mints nothing", () => {
    render(<ConnectAuthorizeClient payload={payload(REQUEST)} />);
    fireEvent.click(screen.getByTestId("connect-deny"));
    expect(nav.length).toBe(1);
    const u = new URL(nav[0]);
    expect(u.searchParams.get("error")).toBe("access_denied");
    expect(u.searchParams.get("state")).toBe("st");
    expect(mintCalls).toEqual([]);
  });

  test("a bad request shows nothing to approve", () => {
    render(<ConnectAuthorizeClient payload={payload({ ...REQUEST, r: "http://evil.example/cb" })} />);
    expect(screen.getByTestId("connect-invalid")).toBeTruthy();
    expect(screen.queryByTestId("connect-allow")).toBeNull();
  });
});
