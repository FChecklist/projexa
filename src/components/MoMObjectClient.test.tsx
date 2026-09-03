/// <reference types="bun-types" />
// R67 D-17 / D-19 / D-21.
//
// SCOPE, stated because it is narrower than the items' Playwright acceptance
// wording: no dev server may be started in this programme, so the Playwright
// runs those items describe were not executed. What IS asserted here is every
// part of the behaviour this harness can actually drive -- which is a lot,
// because the faults were about controls being ABSENT, unworded, or
// irreversible-on-one-click, and all of that is visible at render or behind a
// click. Typing is the one gap: a simulated keystroke into a controlled text
// input does not reach React's onChange under bun + happy-dom + React 19 (see
// src/lib/mom-form.ts's header for the verified detail), so the minutes
// autosave round trip itself is not exercised here.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
// usePathname / useSearchParams: lane A's <ObjectContext> and its
// <FocusRequest> both read them. No ?focus= is set here, so FocusRequest is a
// no-op and these tests exercise the page as a plain visit does.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => { pushed.push(href); } }),
  usePathname: () => "/moms/meeting-1",
  useSearchParams: () => new URLSearchParams(),
}));

const MoMObjectClient = (await import("./MoMObjectClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const BASE_MEETING = {
  id: "mom-1", projectId: "proj-1", title: "Weekly Site Coordination", meetingType: "team",
  status: "draft", scheduledAt: "2026-08-28T09:00:00.000Z", attendees: ["Priya Nair"], agenda: ["Rebar delivery"],
  minutes: "Existing minutes", systemId: "MOM-2026-4821", publishedAt: null,
  aiSummary: null, aiKeyDecisions: [], aiSuggestedActionItems: [], actionItems: [],
};

const LINKS = [
  { id: "lnk-1", token: "tok_abc", expiresAt: "2026-09-09T09:00:00.000Z", revokedAt: null, createdAt: "2026-09-02T09:00:00.000Z" },
];

const ORG_USERS = [
  { id: "u1", name: "Arjun Mehta", email: "arjun@skyline.example", role: "pm" },
  { id: "u2", name: "Priya Nair", email: "priya@skyline.example", role: "site_engineer" },
];

const writes: { url: string; method: string }[] = [];

function mount(overrides: Partial<typeof BASE_MEETING> = {}, props: { justCreated?: boolean } = {}) {
  const meeting = { ...BASE_MEETING, ...overrides };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") writes.push({ url, method });
    if (url.includes("/share-links")) return jsonRes({ links: LINKS });
    if (url.includes("/api/org-users")) return jsonRes({ users: ORG_USERS });
    if (url.includes("/api/moms/mom-1")) return jsonRes(meeting);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<MoMObjectClient meetingId="mom-1" {...props} />);
}

afterEach(() => {
  cleanup();
  writes.length = 0;
  pushed.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("D-17: Edit and Delete are rendered and disabled with the reason, never absent", () => {
  test("a DRAFT offers a real Edit and a real Delete", async () => {
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());
    expect((getByRole("button", { name: /^Edit/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((getByRole("button", { name: /^Delete/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("a PUBLISHED meeting shows both, disabled, each carrying its own reason as visible text", async () => {
    const { getByRole, getByText } = mount({ status: "published", publishedAt: "2026-08-28T11:00:00.000Z" });
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());

    expect((getByRole("button", { name: /^Edit/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole("button", { name: /^Delete/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(getByText(/Published meetings cannot be edited/)).toBeDefined();
    expect(getByText(/Published meetings cannot be deleted/)).toBeDefined();
    // The lock notice stays in the persistent band.
    expect(getByText(/published and locked/)).toBeDefined();
  });
});

describe("D-17: publishing states its blast radius before it happens", () => {
  test("the confirm names the meeting and what locks -- and NO write has been made when it opens", async () => {
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByRole("button", { name: /^Publish & Lock/ })).toBeDefined());

    fireEvent.click(getByRole("button", { name: /^Publish & Lock/ }));

    await waitFor(() =>
      expect(getByText("Title, date, attendees, agenda and minutes can no longer be edited. Action items stay editable.")).toBeDefined()
    );
    expect(getByText(/Publish and lock/)).toBeDefined();
    expect(getByRole("button", { name: "Cancel" })).toBeDefined();
    // The whole point: opening the dialog writes nothing.
    expect(writes).toEqual([]);
  });

  test("Cancel closes it without publishing", async () => {
    const { getByRole, getByText, queryByText } = mount();
    await waitFor(() => expect(getByRole("button", { name: /^Publish & Lock/ })).toBeDefined());
    fireEvent.click(getByRole("button", { name: /^Publish & Lock/ }));
    await waitFor(() => expect(getByText(/Publish and lock/)).toBeDefined());

    fireEvent.click(getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(queryByText(/Publish and lock/)).toBeNull());
    expect(writes).toEqual([]);
  });

  test("Publish is refused, with the reason, while there is unsaved minutes text", async () => {
    // minutes null on the server + a box that will hold "" is the saved state;
    // an UNSAVED state is produced by the server having text the box has not
    // caught up with, which is what a failed autosave leaves behind.
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());
    // At rest the two agree, so Publish is live.
    expect((getByRole("button", { name: /^Publish & Lock/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("D-17: deleting", () => {
  test("the confirm names the meeting by title and writes nothing until it is accepted", async () => {
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByRole("button", { name: /^Delete/ })).toBeDefined());

    fireEvent.click(getByRole("button", { name: /^Delete/ }));
    await waitFor(() => expect(getByText(/Delete .*Weekly Site Coordination/)).toBeDefined());
    expect(writes).toEqual([]);
  });

  test("accepting it DELETEs and returns to the list carrying the confirmation", async () => {
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByRole("button", { name: /^Delete/ })).toBeDefined());
    fireEvent.click(getByRole("button", { name: /^Delete/ }));
    await waitFor(() => expect(getByText(/Delete .*Weekly Site Coordination/)).toBeDefined());

    fireEvent.click(getByRole("button", { name: "Delete meeting" }));

    await waitFor(() => expect(writes.some((w) => w.method === "DELETE" && w.url.includes("/api/moms/mom-1"))).toBe(true));
    await waitFor(() =>
      expect(pushed).toEqual(["/moms?projectId=proj-1&deleted=Weekly%20Site%20Coordination"])
    );
  });
});

describe("D-17: the Export menu, and the minutes box", () => {
  // R67 E-18 / E-20, merged 2026-09-03: this is now the SHARED Export control
  // every screen that produces a document uses. It still shows one word on
  // screen; its ACCESSIBLE name lists the formats behind it, so a screen
  // reader is told what the menu holds instead of hearing a bare "Export".
  test("Export is a worded header action, not a ghost icon in the body", async () => {
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());
    expect(getByRole("button", { name: /^Export/ })).toBeDefined();
  });

  test("a published meeting KEEPS the Export menu -- a locked meeting is exactly the one you send", async () => {
    const { getByRole, getByText } = mount({ status: "published", publishedAt: "2026-08-28T11:00:00.000Z" });
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());
    expect(getByRole("button", { name: /^Export/ })).toBeDefined();
  });

  test("the explicit button is 'Save now' and is inert while the box matches the server", async () => {
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());
    const saveNow = getByRole("button", { name: "Save now" }) as HTMLButtonElement;
    expect(saveNow.disabled).toBe(true);
  });

  test("a published meeting's minutes box is read-only and offers no Save now", async () => {
    const { getByPlaceholderText, queryByRole, getByText } = mount({ status: "published", publishedAt: "2026-08-28T11:00:00.000Z" });
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());
    expect((getByPlaceholderText("Type live meeting notes here…") as HTMLTextAreaElement).disabled).toBe(true);
    expect(queryByRole("button", { name: "Save now" })).toBeNull();
  });

  test("arriving from Save on /moms/new names what was made, with its number, in the persistent band", async () => {
    const { getByText } = mount({}, { justCreated: true });
    await waitFor(() =>
      expect(getByText("Created meeting Weekly Site Coordination (MOM-2026-4821) - start typing the minutes")).toBeDefined()
    );
  });
});

describe("D-19: the people picker replaced a pasted user id", () => {
  test("the old raw-id field and its on-screen apology are gone", async () => {
    const { getByText, queryByText, queryByPlaceholderText } = mount();
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());
    expect(queryByText(/paste a known VERIDIAN user ID/i)).toBeNull();
    expect(queryByText("Assignee (user id)")).toBeNull();
    expect(queryByPlaceholderText("usr_abc123")).toBeNull();
  });

  test("Add is disabled and says why until somebody is chosen", async () => {
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());
    const add = getByRole("button", { name: /^Add/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(getByText(/\(Choose an assignee\)/)).toBeDefined();
  });

  test("the combobox opens with the meeting's own attendees grouped first", async () => {
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByText("Weekly Site Coordination")).toBeDefined());

    fireEvent.click(getByRole("combobox"));
    await waitFor(() => expect(getByText("In this meeting")).toBeDefined());
    // Priya Nair is an attendee of this meeting AND a real org user.
    expect(getByText("Everyone else")).toBeDefined();
    expect(getByText("Site Engineer")).toBeDefined();
    expect(getByText("Project Manager")).toBeDefined();
  });

  test("the facet reads 'Meeting no.', not 'System ID'", async () => {
    const { getByText, queryByText } = mount();
    await waitFor(() => expect(getByText("MOM-2026-4821")).toBeDefined());
    expect(getByText(/Meeting no\./)).toBeDefined();
    expect(queryByText(/System ID/)).toBeNull();
  });
});

describe("D-21: share links are listed with their expiry and a worded Revoke", () => {
  test("an active link shows when it expires and offers Revoke as a word", async () => {
    const { getByRole, getByText } = mount();
    await waitFor(() => expect(getByText(/Active · expires/)).toBeDefined());
    expect(getByRole("button", { name: "Revoke" })).toBeDefined();
  });

  test("the raw token is never printed on screen", async () => {
    const { getByText, queryByText } = mount();
    await waitFor(() => expect(getByText(/Active · expires/)).toBeDefined());
    expect(queryByText(/tok_abc/)).toBeNull();
  });
});
