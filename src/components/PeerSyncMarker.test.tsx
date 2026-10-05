/// <reference types="bun-types" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { PEER_UNREACHABLE_TEXT, setPeerStatus } from "@/lib/local-first/peer/status";
import { PeerSyncMarker } from "./PeerSyncMarker";

afterEach(() => { cleanup(); setPeerStatus({ peers: 0, unreachable: false }); });

describe("PeerSyncMarker", () => {
  test("nothing with no peer; the count of verified laptops otherwise, updating live", () => {
    const { queryByTestId } = render(<PeerSyncMarker />);
    expect(queryByTestId("peer-sync")).toBeNull();
    act(() => setPeerStatus({ peers: 2 }));
    expect(queryByTestId("peer-sync")?.textContent).toBe("Synced with 2 laptops");
    act(() => setPeerStatus({ peers: 1 }));
    expect(queryByTestId("peer-sync")?.textContent).toBe("Synced with 1 laptop");
    act(() => setPeerStatus({ peers: 0 }));
    expect(queryByTestId("peer-sync")).toBeNull();
  });

  test("B22: a laptop heard but not reachable shows one calm sentence, gone the moment a laptop is reached", () => {
    const { queryByTestId } = render(<PeerSyncMarker />);
    act(() => setPeerStatus({ unreachable: true }));
    expect(queryByTestId("peer-sync")?.textContent).toBe(PEER_UNREACHABLE_TEXT);
    expect(PEER_UNREACHABLE_TEXT.match(/[.!?]/g)).toEqual(["."]); // one sentence, ending like one
    expect(PEER_UNREACHABLE_TEXT.endsWith(".")).toBe(true);
    act(() => setPeerStatus({ peers: 1 }));
    expect(queryByTestId("peer-sync")?.textContent).toBe("Synced with 1 laptop");
    act(() => setPeerStatus({ peers: 0 }));
    expect(queryByTestId("peer-sync")).toBeNull(); // reaching a laptop cleared it
  });
});
