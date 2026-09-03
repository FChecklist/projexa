/// <reference types="bun-types" />
// R67 D-71's second half, the same assertion as PermitsListClient.test.tsx:
// route /api/drawings to 500 and the screen must say it could not load,
// offer Retry, and never print the empty-state sentence.
//
// Before this change the catch was `toast.error(...)`, which left `drawings`
// at [] and rendered "No drawings or 3D walkthroughs yet." underneath a
// toast that then faded, leaving only the false sentence.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/drawings",
}));

const DrawingsClient = (await import("./DrawingsClient")).default;

const realFetch = globalThis.fetch;

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof globalThis.fetch;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const PROPS = { projectId: "p-cedar", projectName: "Cedar Heights Villa - Phase 1" };

describe("DrawingsClient", () => {
  test("a 500 shows the failure and never the empty sentence", async () => {
    stubFetch(500, { error: "Something went wrong upstream." });
    const { container } = render(<DrawingsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Couldn't load drawings");
    });
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).not.toContain("No drawings yet");
    expect(container.textContent).not.toContain("0 records");
  });

  test("'supabaseKey is required' is translated, never shown", async () => {
    stubFetch(500, { error: "supabaseKey is required." });
    const { container } = render(<DrawingsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("file storage is not configured for this environment");
    });
    expect(container.textContent).not.toContain("supabaseKey");
  });

  test("only a 200 with zero rows shows the empty sentence", async () => {
    stubFetch(200, { drawings: [] });
    const { container } = render(<DrawingsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("No drawings yet for this project.");
    });
    expect(container.textContent).toContain("0 records");
    expect(container.textContent).not.toContain("Couldn't load drawings");
  });

  test("rows render with a real count", async () => {
    stubFetch(200, {
      drawings: [
        {
          id: "d1",
          name: "Ground floor plan",
          kind: "dwg",
          discipline: "Architectural",
          isExternalLink: false,
          documentUrl: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    const { container } = render(<DrawingsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Ground floor plan");
    });
    expect(container.textContent).toContain("1 record");
  });
});
