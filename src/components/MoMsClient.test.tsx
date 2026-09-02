/// <reference types="bun-types" />
// R67 D-16's own acceptance criterion, run as a real render:
//
//   "with a fetch stub rejecting as a 504: assert the render contains
//    'Retry' and does not contain the string 'No meetings recorded yet'."
//
// That second half is the whole item. Before this change the failure path
// was a `toast.error()` inside a catch, which left `meetings` at [] and so
// rendered the empty sentence over a 504 -- telling a project that has held
// forty meetings that it has never held one, permanently, after the toast
// faded.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- register only if no DOM is installed yet (same guard as
// ui/form-field.test.tsx).
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/moms",
}));

const MoMsClient = (await import("./MoMsClient")).default;

const FILTER = { status: "", from: "2026-05-30", to: "2026-08-28", attendee: "" };

const PROPS = {
  projectId: "p-cedar",
  projectName: "Cedar Heights Villa - Phase 1",
  mode: "project" as const,
  fellBack: false,
  projects: [{ id: "p-cedar", name: "Cedar Heights Villa - Phase 1" }],
  initialFilter: FILTER,
  defaultFilter: FILTER,
};

const realFetch = globalThis.fetch;

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof globalThis.fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("MoMsClient -- a failed read is never an empty list", () => {
  test("a 504 renders Retry and NEVER the empty sentence", async () => {
    stubFetch(504, { error: "The construction data service did not respond in time. Please retry." });
    const { container } = render(<MoMsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Retry");
    });
    expect(container.textContent).not.toContain("No meetings recorded yet");
    // The item's own sentence, naming the project the user was looking at.
    expect(container.textContent).toContain(
      "Couldn't load meetings for Cedar Heights Villa - Phase 1: the construction data service did not respond."
    );
    // ...and the backend's own words are kept, not replaced by ours.
    expect(container.textContent).toContain("The construction data service did not respond in time.");
    // The persistent footer band counts it.
    expect(container.textContent).toContain("1 error");
  });

  test("a 403 says the user has no access, and still never claims emptiness", async () => {
    stubFetch(403, { error: "Forbidden" });
    const { container } = render(<MoMsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("You don't have access to this project's meetings");
    });
    expect(container.textContent).not.toContain("No meetings recorded yet");
  });

  test("only a 200 with zero rows shows the empty sentence", async () => {
    stubFetch(200, { meetings: [] });
    const { container } = render(<MoMsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("No meetings recorded yet - press + New Meeting to start one.");
    });
    expect(container.textContent).not.toContain("Retry");
  });
});

describe("MoMsClient -- the list archetype", () => {
  const rows = [
    {
      id: "m1",
      title: "Site coordination",
      status: "published",
      scheduledAt: "2026-08-28T06:00:00.000Z",
      contextEntityId: "p-cedar",
      attendees: ["Arjun Mehta", "Priya Nair"],
      attendeesCount: 2,
      openActionItems: 3,
    },
  ];

  test("renders the six specified columns in order, with the org's date form and a glyph-plus-word status", async () => {
    stubFetch(200, { meetings: rows });
    const { container } = render(<MoMsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Site coordination");
    });
    const headers = Array.from(container.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toEqual(["Meeting", "Date & time", "Attendees", "Open actions", "Status", "Action"]);
    // R67 D-74: this read "28 Aug 2026, 10:00" under D-16. D-74 is the item
    // that puts the whole product on ONE date form, and its acceptance names
    // this screen among the seven that must all read dd-mm-yyyy. The instant
    // and the org zone are unchanged -- 06:00Z is 10:00 in Asia/Dubai.
    expect(container.textContent).toContain("28-08-2026 10:00");
    // The word, not only a colour.
    expect(container.textContent).toContain("published");
    // Both aggregates render their real numbers.
    const cells = Array.from(container.querySelectorAll("tbody td")).map((td) => td.textContent);
    expect(cells).toContain("2");
    expect(cells).toContain("3");
  });

  test("every row carries an Open link to its object page and an Export PDF link", async () => {
    stubFetch(200, { meetings: rows });
    const { container } = render(<MoMsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Site coordination");
    });
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/moms/m1");
    expect(hrefs).toContain("/api/moms/m1/pdf");
  });

  test("the header offers Filter, Export and New Meeting in that order", async () => {
    stubFetch(200, { meetings: rows });
    const { container } = render(<MoMsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Site coordination");
    });
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
    const trio = buttons.filter((label) => ["Filter", "Export", "New Meeting"].includes(label));
    expect(trio).toEqual(["Filter", "Export", "New Meeting"]);
  });

  test("a count the server never sent renders an en-dash, not a confident 0", async () => {
    stubFetch(200, {
      meetings: [{ ...rows[0], attendeesCount: undefined, openActionItems: undefined, attendees: ["A", "B"] }],
    });
    const { container } = render(<MoMsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Site coordination");
    });
    const cells = Array.from(container.querySelectorAll("tbody td")).map((td) => td.textContent);
    // attendees are still derivable from the row itself...
    expect(cells).toContain("2");
    // ...open actions are not, so the cell says so instead of saying zero.
    expect(cells).toContain("—");
    expect(cells).not.toContain("0");
  });

  test("rows outside the 90-day default are NOT reported as 'no meetings recorded yet'", async () => {
    stubFetch(200, { meetings: [{ ...rows[0], scheduledAt: "2026-01-05T06:00:00.000Z" }] });
    const { container } = render(<MoMsClient {...PROPS} />);

    await waitFor(() => {
      expect(container.textContent).toContain("No meetings match these filters.");
    });
    expect(container.textContent).not.toContain("No meetings recorded yet");
    expect(container.textContent).toContain("Clear filters");
  });

  test("all-projects mode adds a Project column and queries without a projectId", async () => {
    let requested = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(JSON.stringify({ meetings: rows }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const { container } = render(
      <MoMsClient {...PROPS} projectId={null} projectName={null} mode="all" />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("Site coordination");
    });
    expect(requested).toBe("/api/moms");
    const headers = Array.from(container.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toEqual(["Meeting", "Project", "Date & time", "Attendees", "Open actions", "Status", "Action"]);
    expect(container.textContent).toContain("Cedar Heights Villa - Phase 1");
  });

  test("an auto-selected project says so out loud", async () => {
    stubFetch(200, { meetings: [] });
    const { container } = render(<MoMsClient {...PROPS} fellBack />);

    await waitFor(() => {
      expect(container.textContent).toContain("(auto-selected)");
    });
  });
});
