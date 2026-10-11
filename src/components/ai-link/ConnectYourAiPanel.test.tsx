/// <reference types="bun-types" />
// "+ Connect to AI" panel (owner order 2026-10-11): the eight AIs in the owner's order each with a write-up; connect for me; share with teammates;
// the organisation's AI for an owner/admin only; the old prompt button demoted to "Advanced". Real: the components and the connection hook. Faked: fetch.
// Falsifiability: drop "Grok" from CONNECT_PROVIDERS, let a member see the organisation form, or send the key before the length check, and these fail.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { CONNECT_PROVIDERS, modelFor } from "./connect-your-ai-providers";
import ConnectYourAiPanel, { ConnectPanelBody, OwnKeyForm, SharePicker, canManageOrgAi, submitConnection, useOpenOnConnectEvent } from "./ConnectYourAiPanel";
import { describeEffective, OPEN_CONNECT_AI_EVENT, type AiPicture } from "@/lib/ai-connection";

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let picture: AiPicture;
let putAnswer: { ok: boolean; json: unknown };

const none: AiPicture = {
  effective: { connected: false, source: null, provider: null, model: null, sharedByName: null },
  mine: { connected: false, provider: null, model: null, sharedWith: [] },
  sharedWithMe: [],
  org: { connected: false, provider: null, model: null },
};

beforeEach(() => {
  calls = [];
  picture = structuredClone(none);
  putAnswer = { ok: true, json: { connected: true } };
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url) === "/api/org/own-ai" && method === "GET") return new Response(JSON.stringify(picture), { status: 200 });
    if ((String(url) === "/api/org/own-ai" || String(url) === "/api/org/own-ai/mine") && method === "PUT") return new Response(JSON.stringify(putAnswer.json), { status: putAnswer.ok ? 200 : 400 });
    if ((String(url) === "/api/org/own-ai" || String(url) === "/api/org/own-ai/mine") && method === "DELETE") return new Response(JSON.stringify({ connected: false }), { status: 200 });
    if (String(url) === "/api/org/own-ai/people") return new Response(JSON.stringify({ people: [{ id: "u2", name: "Bala", role: "member" }, { id: "u3", name: "Chitra", role: "pm" }] }), { status: 200 });
    if (String(url) === "/api/org/own-ai/shares") return new Response(JSON.stringify({ connected: true }), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(cleanup);

describe("the eight AIs", () => {
  test("are listed in the owner's order, each with a write-up and a way to use it from its own website", () => {
    expect(CONNECT_PROVIDERS.map((p) => p.name)).toEqual(["ChatGPT", "Gemini", "Copilot", "Grok", "DeepSeek", "z.ai", "Claude", "Others"]);
    for (const p of CONNECT_PROVIDERS) {
      expect(p.summary.length).toBeGreaterThan(20);
      expect(p.website.supportNote.length).toBeGreaterThan(30);
      if (p.ownKey) expect(p.ownKey.getKey.length).toBeGreaterThanOrEqual(2);
      else expect(p.noKeyNote).toBeTruthy();
    }
  });

  test("DeepSeek, z.ai, Grok and Others use an OpenRouter key; Grok and z.ai start with their own model; Copilot has no key", () => {
    const by = Object.fromEntries(CONNECT_PROVIDERS.map((p) => [p.id, p]));
    for (const id of ["deepseek", "zai", "grok", "others"]) expect(by[id]!.ownKey!.vendor).toBe("openrouter");
    expect(modelFor(by.grok!)).toBe("x-ai/grok-4");
    expect(modelFor(by.zai!)).toBe("z-ai/glm-4.6");
    expect(by.copilot!.ownKey).toBeNull();
  });
});

describe("sending a key", () => {
  test("a short, empty or wrong-looking key is refused in plain words without any request", async () => {
    const fetchImpl = mock(async () => new Response("{}"));
    const short = await submitConnection("me", { provider: "openai", model: "", apiKey: "abc" }, fetchImpl as unknown as typeof fetch);
    expect(short.ok).toBe(false);
    const claudeUnderChatGpt = await submitConnection("me", { provider: "openai", model: "", apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz" }, fetchImpl as unknown as typeof fetch);
    expect((claudeUnderChatGpt as { error: string }).error).toContain("Claude (Anthropic) key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test("a good key goes to /api/org/own-ai with its scope; the server's own words come back on refusal", async () => {
    expect(await submitConnection("org", { provider: "anthropic", model: " claude-haiku-5-5 ", apiKey: " sk-fake-test-key-for-unit-tests-only " })).toEqual({ ok: true });
    expect(calls[0]).toEqual({ url: "/api/org/own-ai", method: "PUT", body: { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "sk-fake-test-key-for-unit-tests-only" } });
    await submitConnection("me", { provider: "openai", model: "", apiKey: "sk-fake-test-key-for-unit-tests-only" });
    expect(calls[1]!.url).toBe("/api/org/own-ai/mine");
    putAnswer = { ok: false, json: { error: "That key did not work, so nothing was saved. HTTP 401" } };
    expect(await submitConnection("me", { provider: "openai", model: "", apiKey: "sk-fake-test-key-for-unit-tests-only" })).toEqual({ ok: false, error: "That key did not work, so nothing was saved. HTTP 401" });
  });
  test("offline: a plain sentence, nothing saved", async () => {
    const down = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const r = await submitConnection("me", { provider: "openai", model: "", apiKey: "sk-fake-test-key-for-unit-tests-only" }, down);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("nothing was saved");
  });
});

describe("the key form", () => {
  test("sends what was pasted, then wipes the box and says it is connected", async () => {
    const { getByTestId, getByLabelText, findByRole } = render(<OwnKeyForm scope="me" provider={CONNECT_PROVIDERS[0]!} testId="own-key-chatgpt" />);
    const box = getByLabelText("Paste your key") as HTMLInputElement;
    expect(box.type).toBe("password");
    box.value = "sk-fake-test-key-for-unit-tests-only";
    fireEvent.click(getByTestId("own-key-chatgpt-connect"));
    expect((await findByRole("status")).textContent).toContain("Your chat box now works with ChatGPT (OpenAI)");
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-fake-test-key-for-unit-tests-only" });
    expect(box.value).toBe("");
  });
  test("a key that fails shows the reason and keeps what was typed", async () => {
    putAnswer = { ok: false, json: { error: "That key did not work, so nothing was saved." } };
    const { getByTestId, getByLabelText, findByRole } = render(<OwnKeyForm scope="me" provider={CONNECT_PROVIDERS[1]!} testId="own-key-claude" />);
    const box = getByLabelText("Paste your key") as HTMLInputElement;
    box.value = "bad-key-for-unit-tests-only-x";
    fireEvent.click(getByTestId("own-key-claude-connect"));
    expect((await findByRole("alert")).textContent).toContain("nothing was saved");
    expect(box.value).toBe("bad-key-for-unit-tests-only-x");
  });
});

describe("the panel", () => {
  test("not connected: says so plainly, lists all eight, an admin sees the organisation form", async () => {
    const { getByTestId, getByText } = render(<ConnectPanelBody role="admin" />);
    await waitFor(() => expect(getByTestId("own-ai-status").textContent).toContain("No AI connected yet"));
    for (const p of CONNECT_PROVIDERS) expect(getByTestId(`connect-provider-${p.id}`)).toBeTruthy();
    expect(getByTestId("org-key")).toBeTruthy();
    expect(getByText(/Connect your own AI above first/)).toBeTruthy();
  });

  test("a member never sees the organisation form", async () => {
    const { getByTestId, queryByTestId } = render(<ConnectPanelBody role="member" />);
    await waitFor(() => expect(getByTestId("own-ai-status").textContent).toContain("No AI connected yet"));
    expect(getByTestId("org-admin-only")).toBeTruthy();
    expect(queryByTestId("org-key")).toBeNull();
    expect(canManageOrgAi("member")).toBe(false);
    expect(canManageOrgAi("pm")).toBe(false);
    expect(canManageOrgAi("owner")).toBe(true);
  });

  test("my AI connected: the status says so, I can disconnect, and the share picker lists my teammates", async () => {
    picture = { ...none, effective: { connected: true, source: "mine", provider: "openai", model: "gpt-4o-mini", sharedByName: null }, mine: { connected: true, provider: "openai", model: "gpt-4o-mini", sharedWith: [{ id: "u2", name: "Bala" }] } };
    const { getByTestId, findByTestId } = render(<ConnectPanelBody role="member" />);
    await waitFor(() => expect(getByTestId("own-ai-status").textContent).toContain("Using your own AI: ChatGPT (OpenAI)"));
    expect(getByTestId("mine-connected").textContent).toContain("Connected: ChatGPT (OpenAI)");
    expect(((await findByTestId("share-u2")) as HTMLInputElement).checked).toBe(true);
    expect((getByTestId("share-u3") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(getByTestId("mine-disconnect"));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/org/own-ai/mine")).toBe(true));
  });

  test("the status sentence names who shared the AI, or says it is the organisation's", () => {
    expect(describeEffective({ connected: true, source: "shared", provider: "anthropic", model: "x", sharedByName: "Anita" })).toBe("Using Anita's AI, shared with you: Claude (Anthropic)");
    expect(describeEffective({ connected: true, source: "org", provider: "google", model: "x", sharedByName: null })).toBe("Using your organisation's AI: Gemini (Google)");
    expect(describeEffective({ connected: false, source: null, provider: null, model: null, sharedByName: null })).toContain("works as normal software");
  });

  test("the old copy-this-prompt button is gone from the panel; each AI card has the website wizard and the key part", async () => {
    const { getByTestId, queryByTestId, queryByText } = render(<ConnectPanelBody role="admin" />);
    await waitFor(() => expect(getByTestId("own-ai-status")).toBeTruthy());
    expect(queryByTestId("connect-advanced")).toBeNull();
    expect(queryByText("Make my access link and copy the AI prompt")).toBeNull();
    fireEvent.click(within(getByTestId("connect-provider-grok")).getAllByRole("button")[0]!);
    await waitFor(() => expect(getByTestId("wizard-grok")).toBeTruthy());
    expect(getByTestId("own-key-grok")).toBeTruthy();
  });
});

describe("sharing", () => {
  test("saves exactly the ticked teammates", async () => {
    const { getByTestId, findByRole } = render(<SharePicker people={[{ id: "u2", name: "Bala" }, { id: "u3", name: "Chitra" }]} shared={[]} onSaved={() => {}} />);
    fireEvent.click(getByTestId("share-u3"));
    fireEvent.click(getByTestId("share-save"));
    expect((await findByRole("status")).textContent).toContain("1 teammate is now connected");
    expect(calls.find((c) => c.url === "/api/org/own-ai/shares")!.body).toEqual({ userIds: ["u3"] });
  });
});

describe("the button", () => {
  test("says + Connect to AI", () => {
    const { getByTestId } = render(<ConnectYourAiPanel role="member" />);
    expect(getByTestId("connect-your-ai-open").textContent).toContain("+ Connect to AI");
  });
  test("the grey chat box opens the panel through the event", () => {
    let opened = 0;
    function Probe() { useOpenOnConnectEvent(() => { opened += 1; }); return null; }
    render(<Probe />);
    window.dispatchEvent(new Event(OPEN_CONNECT_AI_EVENT));
    window.dispatchEvent(new Event(OPEN_CONNECT_AI_EVENT));
    expect(opened).toBe(2);
  });
});
