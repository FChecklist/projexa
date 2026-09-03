/// <reference types="bun-types" />
// R67 D-65 -- Manpower's two panels adopt PaneState.
//
// MERGE NOTE: this is lane D0's suite for LabourClient, kept in its own file.
// Lane D3 wrote a suite for the SAME component from no common ancestor
// (LabourClient.test.tsx, covering D-30/D-32/D-53's header band, filter,
// export and daily-sheets tab). The two are separate files because each
// carries its own fetch-router harness with its own helper names, and
// hand-splicing them would risk silently weakening whichever lost. Both run.
//
// This screen already held a per-panel error and never printed an empty
// sentence over a failure, so the assertions here are about the two things
// that were still wrong: the failure sentence came from errorMessage()
// ("Roster: supabaseKey is required") instead of the shared dictionary, and
// a failed refresh called setRoster([]) -- blanking a roster the user could
// read a second ago.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/labour",
}));

const LabourClient = (await import("./LabourClient")).default;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function routeFetch(handler: (url: string) => { status: number; body: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const { status, body } = handler(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

const WORKER = {
  id: "w1",
  name: "Ramesh Kumar",
  employeeCode: "L-001",
  trade: "Mason",
  skillLevel: null,
  vendorId: null,
  dailyRate: "180",
  isActive: true,
};

describe("LabourClient", () => {
  test("a failed roster read never says 'No workers on the roster yet.'", async () => {
    routeFetch((url) =>
      url.includes("/api/labour-roster")
        ? { status: 500, body: { error: "The construction data service returned an error." } }
        : { status: 200, body: {} }
    );

    const { container } = render(<LabourClient projectId="p-cedar" />);
    await waitFor(() => {
      expect(container.textContent).toContain("Couldn't load the roster");
    });
    expect(container.textContent).not.toContain("No workers on the roster yet.");
    // "0 records" over a failed read is a claim nobody made.
    expect(container.textContent).not.toContain("0 records");
  });

  test("'supabaseKey is required' reaches the user as plain words, from the one dictionary", async () => {
    routeFetch((url) =>
      url.includes("/api/labour-roster")
        ? { status: 500, body: { error: "supabaseKey is required." } }
        : { status: 200, body: {} }
    );

    const { container } = render(<LabourClient projectId="p-cedar" />);
    await waitFor(() => {
      expect(container.textContent).toContain("file storage is not configured for this environment");
    });
    expect(container.textContent).not.toContain("supabaseKey");
  });

  test("a successful, genuinely empty roster still says so, with a real count", async () => {
    routeFetch(() => ({ status: 200, body: { roster: [], attendance: [], vendors: [] } }));

    const { container } = render(<LabourClient projectId="p-cedar" />);
    await waitFor(() => {
      expect(container.textContent).toContain("No workers on the roster yet.");
    });
    expect(container.textContent).toContain("0 records");
    expect(container.textContent).not.toContain("Couldn't load the roster");
  });

  test("rows render with a real count", async () => {
    routeFetch(() => ({ status: 200, body: { roster: [WORKER], attendance: [], vendors: [] } }));

    const { container } = render(<LabourClient projectId="p-cedar" />);
    await waitFor(() => {
      expect(container.textContent).toContain("Ramesh Kumar");
    });
    expect(container.textContent).toContain("1 record");
  });
});
