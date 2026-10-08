import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

// P6: the owner's switch is OFF by default, flipping it sends the change and the switch then shows what the server says.
// Falsifiability: in InternalAiCard.tsx make `checked` always true, or send allowed: !next, and these tests fail.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import InternalAiCard, { INTERNAL_AI_EXPLANATION } from "./InternalAiCard";

afterEach(cleanup);

function fakeServer(fail = false) {
  const calls: Array<{ method: string; body?: unknown }> = [];
  let allowed = false;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "PUT") {
      if (fail) return new Response(JSON.stringify({ error: "no" }), { status: 403 });
      allowed = (calls.at(-1)!.body as { allowed: boolean }).allowed;
    }
    return new Response(JSON.stringify({ allowed, changedAt: allowed ? "2026-10-08T10:00:00Z" : null }), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

describe("InternalAiCard", () => {
  test("default is OFF and the one-line explanation is shown", async () => {
    fakeServer();
    const { getByTestId, getByText } = render(<InternalAiCard />);
    await waitFor(() => expect((getByTestId("internal-ai-switch") as HTMLButtonElement).disabled).toBe(false));
    expect(getByTestId("internal-ai-switch").getAttribute("aria-checked")).toBe("false");
    expect(getByText(INTERNAL_AI_EXPLANATION)).toBeTruthy();
    expect(INTERNAL_AI_EXPLANATION).toContain("never change code");
    expect(INTERNAL_AI_EXPLANATION).toContain("role");
  });
  test("flipping it sends allowed:true and the switch shows ON from the server's answer", async () => {
    const calls = fakeServer();
    const { getByTestId } = render(<InternalAiCard />);
    await waitFor(() => expect((getByTestId("internal-ai-switch") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByTestId("internal-ai-switch"));
    await waitFor(() => expect(getByTestId("internal-ai-switch").getAttribute("aria-checked")).toBe("true"));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ allowed: true });
  });
  test("a refused change leaves the switch OFF", async () => {
    fakeServer(true);
    const { getByTestId } = render(<InternalAiCard />);
    await waitFor(() => expect((getByTestId("internal-ai-switch") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByTestId("internal-ai-switch"));
    await waitFor(() => expect((getByTestId("internal-ai-switch") as HTMLButtonElement).disabled).toBe(false));
    expect(getByTestId("internal-ai-switch").getAttribute("aria-checked")).toBe("false");
  });
});
