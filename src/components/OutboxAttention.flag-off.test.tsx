/// <reference types="bun-types" />
// LOCAL-FIRST, flag OFF (package lf-fc, review cost:TEST-11 / FLAG-16): with a person signed in and the `px-local-first` flag
// NOT "1", OutboxAttention (through use-outbox-state.ts) must not even create the shared outbox -- no IndexedDB, no online
// listener, no flush. The existing "with the flag off it does not even look" case never set an active user, so it passed for a
// different reason (no user) and stayed green when the flag check was removed. This file sets the user, so it is the flag
// check alone that keeps the outbox closed. A control case with the flag ON proves the spy would see the call.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";

const getSharedOutbox = mock((_userId: string) => ({
  refresh: async () => ({ pending: 0, ops: [], conflicts: [], blocked: [], notices: [], drafts: [], status: "idle" }),
  getState: () => ({ pending: 0, ops: [], conflicts: [], blocked: [], notices: [], drafts: [], status: "idle" }),
  subscribe: () => () => {},
}));
mock.module("@/lib/local-first/outbox-shared", () => ({
  getSharedOutbox,
  peekSharedOutbox: () => null,
  releaseSharedOutbox: () => {},
  startOutbox: () => {},
  getDeviceId: () => "dev-test",
}));

const { LOCAL_FIRST_FLAG, setActiveLocalUser } = await import("@/lib/local-first/local-reader");
const { OutboxAttention } = await import("./OutboxAttention");

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

afterEach(() => {
  cleanup();
  localStorage.removeItem(LOCAL_FIRST_FLAG);
  setActiveLocalUser(null);
  getSharedOutbox.mockClear();
});

describe("OutboxAttention with a signed-in person", () => {
  test("flag OFF: the shared outbox is never created and nothing is rendered", async () => {
    setActiveLocalUser("u1");
    localStorage.removeItem(LOCAL_FIRST_FLAG);
    const view = render(<OutboxAttention />);
    await settle();
    expect(getSharedOutbox).not.toHaveBeenCalled();
    expect(view.container.innerHTML).toBe("");
  });

  test("control: flag ON, the same person -> the shared outbox IS opened for them", async () => {
    setActiveLocalUser("u1");
    localStorage.setItem(LOCAL_FIRST_FLAG, "1");
    render(<OutboxAttention />);
    await settle();
    expect(getSharedOutbox).toHaveBeenCalledWith("u1");
  });
});
