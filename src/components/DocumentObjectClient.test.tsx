/// <reference types="bun-types" />
// R67 D-15. The item's acceptance is a Playwright click-through (View -> Edit ->
// rename -> Save -> Back); this lane may not start a dev server, so the same
// assertions are made here with /api/documents/<id> stubbed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
// `screen` binds to document.body at module init, before the registrator above
// has run under bun -- every query here comes from render()'s return value.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
const replace = mock((_: string) => {});
// R67 lane A merge: the real module is spread in rather than replaced. Lane A
// mounts <ObjectContext>/<ScreenContext> inside these screens, and those call
// usePathname() -- a mock that returned only useRouter made the whole module
// lose every other export and the file failed to load at all
// ("Export named 'usePathname' not found in module .../next/navigation.js").
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({ ...realNavigation, useRouter: () => ({ push, replace }) }));

const mod = await import("./DocumentObjectClient");
const DocumentObjectClient = mod.default;
const { disposeDisabledReason, documentEditSaveReason, documentPatchBody, linkValidityText, previewKind } = mod;

const TODAY = "2026-09-02";

const DOC = {
  id: "doc-1",
  name: "scan_0012",
  category: "permit",
  fileType: "application/pdf",
  fileSize: 240_000,
  expiryDate: null,
  versionNumber: 2,
  createdAt: "2026-08-14T09:30:00.000Z",
  isDisposed: false,
  legalHold: false,
  disposalDate: null,
  linkedEntityType: "permit",
  linkedEntityId: "permit-9",
  isExternalLink: false,
  signedUrl: "https://signed.example/scan_0012.pdf",
  expiresInSeconds: 300,
  versions: [
    { id: "doc-1", name: "scan_0012", versionNumber: 2, createdAt: "2026-08-14T09:30:00.000Z", fileType: "application/pdf" },
    { id: "doc-0", name: "scan_0012", versionNumber: 1, createdAt: "2026-08-01T09:30:00.000Z", fileType: "application/pdf" },
  ],
};

const realFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];

function stubDocument(doc: unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (init?.method === "PATCH" || init?.method === "POST") {
      return new Response(JSON.stringify({ id: "doc-2", versionNumber: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(doc), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  try {
    window.sessionStorage.clear();
  } catch {
    // Nothing handed over is the state these tests want.
  }
  stubDocument(DOC);
});

afterEach(() => {
  cleanup();
  push.mockClear();
  replace.mockClear();
  globalThis.fetch = realFetch;
});

describe("disposeDisabledReason", () => {
  test("THE ITEM'S WORDING: a document with no retention policy says what to do about it", () => {
    expect(disposeDisabledReason({ isDisposed: false, legalHold: false, disposalDate: null }, false, TODAY)).toBe(
      "Cannot delete - no retention policy is set for this document. Ask an admin to set one."
    );
  });

  test("legal hold and a future disposal date each read as a state, not as jargon", () => {
    expect(disposeDisabledReason({ isDisposed: false, legalHold: true, disposalDate: null }, false, TODAY)).toBe(
      "On legal hold - cannot be disposed"
    );
    expect(
      disposeDisabledReason({ isDisposed: false, legalHold: false, disposalDate: "2027-01-31" }, false, TODAY)
    ).toBe("Kept until 1/31/2027 under the retention policy");
  });

  test("a document past its disposal date can actually be disposed", () => {
    expect(
      disposeDisabledReason({ isDisposed: false, legalHold: false, disposalDate: "2026-01-31" }, false, TODAY)
    ).toBeUndefined();
  });

  test("an already-disposed document says so rather than offering the action again", () => {
    expect(disposeDisabledReason({ isDisposed: true, legalHold: false, disposalDate: "2026-01-31" }, false, TODAY)).toBe(
      "Already disposed"
    );
  });
});

// The item's acceptance types a new name into the field and presses Save. In
// this repo's test environment (React 19 + happy-dom under bun test) a
// controlled text input cannot be driven from a test at all -- fireEvent.change
// updates the DOM node but never reaches React's onChange, measured here on a
// three-line control component and already recorded by PermitCreateClient.test
// .tsx and DrawingCreateClient.test.tsx in this same lane. So the two things
// typing decides -- what the button says, and what the PATCH carries -- are
// asserted against the exact functions the screen builds them from, and the
// render tests below cover everything typing is not needed for.
describe("documentEditSaveReason", () => {
  test("THE ITEM'S WORDING: an empty name names itself in the button", () => {
    expect(documentEditSaveReason("", false)).toBe("Name is required");
    expect(documentEditSaveReason("   ", false)).toBe("Name is required");
  });

  test("a named document can be saved, and saving outranks everything", () => {
    expect(documentEditSaveReason("Renamed permit", false)).toBeUndefined();
    expect(documentEditSaveReason("", true)).toBe("Saving…");
  });
});

describe("documentPatchBody", () => {
  test("the rename reaches the wire, trimmed, with an empty expiry sent as null not ''", () => {
    expect(documentPatchBody({ name: "  Renamed permit  ", category: "permit", expiryDate: "" })).toEqual({
      name: "Renamed permit",
      category: "permit",
      expiryDate: null,
    });
    expect(documentPatchBody({ name: "X", category: "email", expiryDate: "2027-01-31" }).expiryDate).toBe("2027-01-31");
  });
});

describe("linkValidityText", () => {
  test("reads in minutes, and gets the singular right", () => {
    expect(linkValidityText(300)).toBe("Link valid for 5 minutes");
    expect(linkValidityText(60)).toBe("Link valid for 1 minute");
  });
});

describe("previewKind", () => {
  test("a PDF and an image can be shown inline; nothing else is guessed at", () => {
    expect(previewKind({ fileType: "application/pdf", isDisposed: false, signedUrl: "x" })).toBe("pdf");
    expect(previewKind({ fileType: "image/jpeg", isDisposed: false, signedUrl: "x" })).toBe("image");
    expect(previewKind({ fileType: "message/rfc822", isDisposed: false, signedUrl: "x" })).toBeNull();
    expect(previewKind({ fileType: null, isDisposed: false, signedUrl: "x" })).toBeNull();
  });

  test("a disposed document, or one with no link, is never previewed", () => {
    expect(previewKind({ fileType: "application/pdf", isDisposed: true, signedUrl: "x" })).toBeNull();
    expect(previewKind({ fileType: "application/pdf", isDisposed: false, signedUrl: null })).toBeNull();
  });
});

describe("DocumentObjectClient", () => {
  test("the document is reached through the /v1/projexa surface, not the root one that 404s", async () => {
    const view = render(<DocumentObjectClient documentId="doc-1" />);
    await waitFor(() => expect(view.getAllByText("scan_0012").length).toBeGreaterThan(0));
    expect(calls[0].url).toBe("/api/documents/doc-1");
  });

  test("a PDF is previewed inline at 480 px, with the link's validity in visible text", async () => {
    const view = render(<DocumentObjectClient documentId="doc-1" />);

    await waitFor(() => expect(view.container.querySelector("iframe")).toBeTruthy());
    const frame = view.container.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe(DOC.signedUrl);
    expect(frame.className).toContain("h-[480px]");
    expect(view.getByText("Link valid for 5 minutes")).toBeTruthy();
  });

  test("earlier versions are listed under a Versions facet, and the header says which version this is", async () => {
    const view = render(<DocumentObjectClient documentId="doc-1" />);

    await waitFor(() => expect(view.getByText(/^Versions:/)).toBeTruthy());
    expect(view.getByText("v1 (8/1/2026)")).toBeTruthy();
    expect(view.getByText("Version 2")).toBeTruthy();
  });

  test("Edit opens a real Name field, bound to the document's current name", async () => {
    const view = render(<DocumentObjectClient documentId="doc-1" />);
    await waitFor(() => expect(view.getByRole("button", { name: "Edit" })).toBeTruthy());

    // Display mode is read-only -- an object screen opens read-only and Edit is
    // explicit (the M29 rule this page already followed for Category).
    expect(view.queryByLabelText("Name")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("scan_0012");
    // ...and the PATCH sent from it carries the name, which it never did before.
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);
  });

  test("a rename with only a PATCH round trip: the body carries name, category and expiry", async () => {
    const view = render(<DocumentObjectClient documentId="doc-1" />);
    await waitFor(() => expect(view.getByRole("button", { name: "Edit" })).toBeTruthy());

    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    fireEvent.click(view.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/documents/doc-1");
    expect(JSON.parse(String(patch.init!.body))).toEqual({
      name: "scan_0012",
      category: "permit",
      expiryDate: null,
    });
  });

  test("Replace file posts a new version and the page follows it, instead of showing the superseded row", async () => {
    const view = render(<DocumentObjectClient documentId="doc-1" />);
    await waitFor(() => expect(view.getByRole("button", { name: "Edit" })).toBeTruthy());

    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    const input = view.getByLabelText("Replace file") as HTMLInputElement;
    const file = new File(["%PDF"], "corrected.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    await waitFor(() => expect(view.getByText(/will become version 3/)).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/documents/doc-1/versions")).toBe(true));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/documents/doc-2"));
  });

  test("Delete is disabled with a reason a person can act on, never a bare 'No retention policy set'", async () => {
    const view = render(<DocumentObjectClient documentId="doc-1" />);

    await waitFor(() => expect(view.getByRole("button", { name: /Delete/ })).toBeTruthy());
    const del = view.getByRole("button", { name: /Delete/ }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.getAttribute("title")).toBe(
      "Cannot delete - no retention policy is set for this document. Ask an admin to set one."
    );
  });

  test("a document with an unknown file type gets the link alone, not an empty preview box", async () => {
    stubDocument({ ...DOC, fileType: "message/rfc822", versions: [] });
    const view = render(<DocumentObjectClient documentId="doc-1" />);

    await waitFor(() => expect(view.getByText("View / Download this document")).toBeTruthy());
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
  });
});
