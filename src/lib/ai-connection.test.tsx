/// <reference types="bun-types" />
// The connection hook the grey chat box reads: unknown until answered (the box stays open, no flash of grey), then connected or not; remembered for
// the next load and for offline; re-read when something announces a change. Faked: fetch. Storage is the DOM's own.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { announceAiConnectionChanged, useAiConnection, type AiPicture } from "./ai-connection";

const pic = (connected: boolean): AiPicture => ({
  effective: { connected, source: connected ? "org" : null, provider: connected ? "openai" : null, model: null, sharedByName: null },
  mine: { connected: false, provider: null, model: null, sharedWith: [] },
  sharedWithMe: [],
  org: { connected, provider: null, model: null },
});

let answer: AiPicture | "down" = pic(false);
function Probe() {
  const s = useAiConnection();
  return <p data-testid="probe">{`${s.known ? "known" : "unknown"}:${s.connected ? "connected" : "not"}`}</p>;
}

beforeEach(() => {
  window.localStorage.clear();
  answer = pic(false);
  globalThis.fetch = mock(async () => (answer === "down" ? new Response("{}", { status: 503 }) : new Response(JSON.stringify(answer), { status: 200 }))) as unknown as typeof fetch;
});
afterEach(cleanup);

describe("useAiConnection", () => {
  test("not connected -> known:not; connected -> known:connected after a change is announced", async () => {
    const { getByTestId } = render(<Probe />);
    await waitFor(() => expect(getByTestId("probe").textContent).toBe("known:not"));
    answer = pic(true);
    await act(async () => { announceAiConnectionChanged(); });
    await waitFor(() => expect(getByTestId("probe").textContent).toBe("known:connected"));
  });

  test("the last answer is remembered, so the next load (or offline) does not flash grey", async () => {
    const first = render(<Probe />);
    answer = pic(true);
    await act(async () => { announceAiConnectionChanged(); });
    await waitFor(() => expect(first.getByTestId("probe").textContent).toBe("known:connected"));
    first.unmount();
    answer = "down";
    const second = render(<Probe />);
    await waitFor(() => expect(second.getByTestId("probe").textContent).toBe("known:connected"));
  });

  test("never heard from the service and nothing remembered: unknown, so the chat box is not greyed on a guess", async () => {
    answer = "down";
    const { getByTestId } = render(<Probe />);
    await new Promise((r) => setTimeout(r, 50));
    expect(getByTestId("probe").textContent).toBe("unknown:not");
  });

  test("a malformed answer (an empty object, an error body) is ignored, never read as connected or not", async () => {
    globalThis.fetch = mock(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const { getByTestId } = render(<Probe />);
    await new Promise((r) => setTimeout(r, 50));
    expect(getByTestId("probe").textContent).toBe("unknown:not");
  });
});
