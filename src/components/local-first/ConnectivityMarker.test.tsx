import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
// `screen` is not used: static imports run before the registration above, and `screen` binds to the document at import time.
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createConnectivity, useConnectivity, WORKING_LOCALLY_TEXT, type Connectivity } from "@/lib/local-first/connectivity";
import { ConnectivityMarker, ConnectivityMarkerView } from "./ConnectivityMarker";

afterEach(cleanup);

describe("the connectivity marker", () => {
  test("online: nothing at all is rendered", () => {
    const { container } = render(<ConnectivityMarkerView state="online" />);
    expect(container.innerHTML).toBe("");
  });

  test("offline and server_down: the same calm sentence, as a polite status, never a dialog or an alert", () => {
    for (const state of ["offline", "server_down"] as Connectivity[]) {
      cleanup();
      const { getByTestId } = render(<ConnectivityMarkerView state={state} />);
      const marker = getByTestId("connectivity-marker");
      expect(marker.getAttribute("role")).toBe("status");
      expect(marker.getAttribute("aria-live")).toBe("polite");
      expect(marker.textContent).toBe(WORKING_LOCALLY_TEXT);
      expect(marker.textContent).toBe("Working on this laptop; will sync when connected");
      expect(document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"], dialog') === null).toBe(true);
      expect(marker.querySelector("button, a, input") === null).toBe(true); // asks nothing of the person
      expect(marker.className).toContain("pointer-events-none"); // never in the way of a click
    }
  });
});

describe("useConnectivity follows the state live", () => {
  function controller() {
    let online = true;
    let notify = () => {};
    const c = createConnectivity({ isOnline: () => online, probe: async () => false, listenToBrowser: (fn) => { notify = fn; return () => {}; }, setTimer: () => 0, clearTimer: () => {} });
    c.start();
    return { c, setOnline: (v: boolean) => { online = v; notify(); } };
  }

  test("the hook and the marker update when the state changes, and only then", () => {
    const { c, setOnline } = controller();
    const { result } = renderHook(() => useConnectivity(c));
    expect(result.current).toBe("online");
    act(() => setOnline(false));
    expect(result.current).toBe("offline");
    act(() => setOnline(true));
    act(() => { c.reportFailure(); c.reportFailure(); c.reportFailure(); });
    expect(result.current).toBe("server_down");
    act(() => c.reportSuccess());
    expect(result.current).toBe("online");
  });

  test("ConnectivityMarker with the shared state renders nothing while the page is online", () => {
    const { container } = render(<ConnectivityMarker />);
    expect(container.innerHTML).toBe("");
  });
});
