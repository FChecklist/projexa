/// <reference types="bun-types" />
// R67 D-67 -- /work-progress/[id], the page a logged progress entry never had.
//
// The three things worth pinning: the site photo is actually reachable (it
// was reachable from nowhere in the UI before), "this entry is not here" is
// only sayable after a read that SUCCEEDED, and a failed read says it failed
// rather than rendering an empty record.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/work-progress/e1",
}));

const WorkProgressEntryObjectClient = (await import("./WorkProgressEntryObjectClient")).default;
const { ProjectScopeProvider } = await import("./shell/project-context");

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const CEDAR = { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" };

const ENTRY = {
  id: "e1",
  activityId: "a1",
  boqLineItemId: null,
  entryDate: "2026-08-28",
  quantityDone: "120",
  percentComplete: "45",
  entryBasis: "quantity",
  remarks: "Poured the raft slab, east half.",
};

function routeFetch(handler: (url: string) => { status: number; body: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const { status, body } = handler(String(input));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
}

function renderPage() {
  return render(
    <ProjectScopeProvider
      value={{
        projects: [CEDAR],
        project: CEDAR,
        projectId: CEDAR.id,
        projectsLoaded: true,
        selectProject: () => {},
        openSwitcher: () => {},
      }}
    >
      <WorkProgressEntryObjectClient entryId="e1" projectId={CEDAR.id} projectName={CEDAR.name} />
    </ProjectScopeProvider>
  );
}

describe("WorkProgressEntryObjectClient", () => {
  test("renders the entry, its activity NAME and its remarks", async () => {
    routeFetch((url) => {
      if (url.includes("/api/work-progress/activities")) {
        return { status: 200, body: { activities: [{ id: "a1", name: "Concrete works", unit: "m3" }] } };
      }
      if (url.includes("/api/work-progress/photos")) return { status: 200, body: { photos: [] } };
      return { status: 200, body: { entries: [ENTRY] } };
    });

    const { container } = renderPage();
    await waitFor(() => expect(container.textContent).toContain("Poured the raft slab, east half."));
    // The NAME, never the raw activity id.
    expect(container.textContent).toContain("Concrete works");
    expect(container.textContent).not.toContain("a1");
    expect(container.textContent).toContain("45%");
  });

  test("the site photo is reachable -- it was reachable from nowhere in the UI before", async () => {
    routeFetch((url) => {
      if (url.includes("/api/work-progress/photos")) {
        return {
          status: 200,
          body: {
            photos: [
              {
                id: "ph1",
                fileName: "raft-slab-east.jpg",
                contentType: "image/jpeg",
                createdAt: "2026-08-28T09:00:00.000Z",
                url: "https://example.test/signed/raft-slab-east.jpg",
              },
            ],
          },
        };
      }
      if (url.includes("/api/work-progress/activities")) return { status: 200, body: { activities: [] } };
      return { status: 200, body: { entries: [ENTRY] } };
    });

    const { container, findByAltText } = renderPage();
    const img = await findByAltText("raft-slab-east.jpg");
    expect(img.getAttribute("src")).toBe("https://example.test/signed/raft-slab-east.jpg");
    expect(container.textContent).toContain("raft-slab-east.jpg");
  });

  test("a failed read says it failed rather than rendering an empty record", async () => {
    routeFetch((url) =>
      url.includes("/api/work-progress/photos")
        ? { status: 200, body: { photos: [] } }
        : { status: 504, body: { error: "upstream gone" } }
    );

    const { container } = renderPage();
    await waitFor(() => expect(container.textContent).toContain("Couldn't load this progress entry"));
    expect(container.textContent).not.toContain("is not on Cedar Heights Villa");
  });

  test("'not on this project' is reachable only from a successful read", async () => {
    routeFetch((url) => {
      if (url.includes("/api/work-progress/photos")) return { status: 200, body: { photos: [] } };
      if (url.includes("/api/work-progress/activities")) return { status: 200, body: { activities: [] } };
      return { status: 200, body: { entries: [] } };
    });

    const { container } = renderPage();
    await waitFor(() =>
      expect(container.textContent).toContain("This progress entry is not on Cedar Heights Villa - Phase 1.")
    );
  });

  test("a failed PHOTO read does not blank the entry the user came to see", async () => {
    routeFetch((url) => {
      if (url.includes("/api/work-progress/photos")) return { status: 500, body: { error: "storage unavailable" } };
      if (url.includes("/api/work-progress/activities")) return { status: 200, body: { activities: [] } };
      return { status: 200, body: { entries: [ENTRY] } };
    });

    const { container } = renderPage();
    await waitFor(() => expect(container.textContent).toContain("Could not load the photos for this entry"));
    expect(container.textContent).toContain("Poured the raft slab, east half.");
  });
});
