/// <reference types="bun-types" />
// R67 D-55 / D-65 -- the same assertion as PermitsListClient.test.tsx and
// DrawingsClient.test.tsx, for the third screen R-184 named by its exact
// output: "'No documents found for this project.' after a 504".
//
// Before this change the catch was `toast.error(...)` and `docs` stayed at
// [], so a 504 rendered the empty sentence with a notification that faded
// four seconds later -- leaving only the false claim on screen.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/documents",
}));

const DocumentsClient = (await import("./DocumentsClient")).default;

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

const ONE_DOC = {
  id: "doc-1",
  name: "Structural NOC.pdf",
  category: "permit",
  fileType: "pdf",
  fileSize: 51200,
  expiryDate: null,
  versionNumber: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
};

describe("DocumentsClient", () => {
  test("a 504 shows the failure and never the empty sentence", async () => {
    stubFetch(504, { error: "The construction data service did not respond." });
    const { container } = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Couldn't load documents");
    });
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).not.toContain("No documents yet");
    expect(container.textContent).not.toContain("No documents found for this project.");
    expect(container.textContent).not.toContain("0 records");
  });

  test("'supabaseKey is required' becomes words a user can act on", async () => {
    // Documents is the module where this message actually surfaces -- the
    // file store is what serves them.
    stubFetch(500, { error: "supabaseKey is required." });
    const { container } = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("file storage is not configured for this environment");
    });
    expect(container.textContent).not.toContain("supabaseKey");
  });

  test("only a 200 with zero rows shows the empty sentence, and it names the project", async () => {
    stubFetch(200, { documents: [] });
    const { container } = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("No documents yet for Cedar Heights Villa - Phase 1.");
    });
    expect(container.textContent).toContain("0 records");
    expect(container.textContent).not.toContain("Couldn't load documents");
  });

  test("rows render with a real count", async () => {
    stubFetch(200, { documents: [ONE_DOC] });
    const { container } = render(<DocumentsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Structural NOC.pdf");
    });
    expect(container.textContent).toContain("1 record");
  });
});
