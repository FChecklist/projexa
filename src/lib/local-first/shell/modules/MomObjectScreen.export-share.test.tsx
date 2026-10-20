import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ShellApi } from "../types";
import type { MomObjectData } from "./moms-adapter";

// R-C04 parity: the laptop-first minutes page offers Export PDF and Share link like the online page, online only, and says why when it cannot.
mock.module("./documents-writes", () => ({ addMomActionItemOffline: async () => ({ ok: true }), amendMinutesOffline: async () => ({ ok: true }), canProposeEdits: () => true }));
const { default: MomObjectScreen } = await import("./MomObjectScreen");

const mom = (waiting = false) => ({ id: "m1", title: "Site meeting", status: "draft", scheduledAt: null, meetingType: null, publishedAt: null, attendeeCount: 0, attendeeNames: null, agenda: null, minutes: "Pour agreed.", waiting });
const data = (waiting = false) => ({ state: "local", projectId: "p1", syncedAt: null, mom: mom(waiting), pendingActionItems: [] }) as unknown as MomObjectData;
const shell = (connectivity: "online" | "offline") => ({ data: { role: "manager" } as never, projectId: "p1", connectivity, refresh() {}, setProjectId() {}, navigate() {}, writer: {} }) as unknown as ShellApi;
const view = (c: "online" | "offline", waiting = false) => render(<MomObjectScreen shell={shell(c)} params={{}} query={new URLSearchParams()} data={data(waiting)} />);

let fetchCalls: { url: string; method?: string }[];
beforeEach(() => {
  fetchCalls = [];
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: { method?: string }) => {
    fetchCalls.push({ url, method: init?.method });
    return new Response(JSON.stringify({ shareUrl: "https://projexa-ai.com/shared/mom/tok", expiresAt: "2026-12-01T00:00:00Z" }), { status: 201 });
  };
});
afterEach(cleanup);

describe("MomObjectScreen export and share (R-C04 parity)", () => {
  test("online: Export PDF is a link to the same /api/moms/<id>/pdf relay the online page uses", () => {
    const { getByTestId } = view("online");
    const a = getByTestId("mom-export-pdf") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("/api/moms/m1/pdf");
  });

  test("online: Share link posts to the share-links route and shows the link it got", async () => {
    const { getByTestId } = view("online");
    fireEvent.click(getByTestId("mom-share-link"));
    await waitFor(() => expect((getByTestId("mom-share-url") as HTMLInputElement).value).toBe("https://projexa-ai.com/shared/mom/tok"));
    expect(fetchCalls).toEqual([{ url: "/api/moms/m1/share-links", method: "POST" }]);
  });

  test("online: a server refusal is shown in words, with no link", async () => {
    (globalThis as { fetch: unknown }).fetch = async () => new Response(JSON.stringify({ error: "Not allowed" }), { status: 403 });
    const { getByTestId, queryByTestId } = view("online");
    fireEvent.click(getByTestId("mom-share-link"));
    await waitFor(() => expect(getByTestId("mom-share-note").getAttribute("data-ok")).toBe("0"));
    expect(getByTestId("mom-share-note").textContent).toContain("Not allowed");
    expect(queryByTestId("mom-share-url")).toBeNull();
  });

  test("offline: both are disabled, never call the server, and the reason is written beside them", () => {
    const { getByTestId } = view("offline");
    expect((getByTestId("mom-export-pdf") as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId("mom-share-link") as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId("mom-server-reason").textContent).toContain("Needs a connection");
    fireEvent.click(getByTestId("mom-share-link"));
    expect(fetchCalls).toHaveLength(0);
  });

  test("a meeting still waiting to sync is disabled with its own reason even when online", () => {
    const { getByTestId } = view("online", true);
    expect((getByTestId("mom-share-link") as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId("mom-server-reason").textContent).toContain("waiting to sync");
  });
});
