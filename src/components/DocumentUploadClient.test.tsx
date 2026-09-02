/// <reference types="bun-types" />
// R67 D-14. The item's own acceptance, run here rather than in Playwright
// (this lane may not start a dev server): drop a File named
// "DEWA_permit_2026.pdf" on the zone and the Name input reads
// "DEWA_permit_2026" while the Category select reads "permit" -- the form
// reading the file it was handed instead of filing every permit as "other".
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
// `screen` binds to document.body at module init, before the registrator above
// has run under bun -- every query here comes from render()'s return value.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mod = await import("./DocumentUploadClient");
const DocumentUploadClient = mod.default;
const { DROP_ZONE_LABEL, decodeRelatesTo, documentSaveReason, encodeRelatesTo } = mod;

const PROJECT = "Cedar Heights Villa - Phase 1";
const realFetch = globalThis.fetch;

/** The three "Relates to" lookups the screen makes on mount. */
function stubLookups() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/api/permits")
      ? { permits: [{ id: "permit-9", name: "Building Permit - Villa 21", permitNumber: "BP-2026-0142" }] }
      : url.includes("/api/rfis")
        ? { rfis: [{ id: "rfi-3", number: 3, subject: "Slab level clash" }] }
        : { meetings: [{ id: "mom-1", title: "Weekly site meeting" }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // Nothing remembered is the state this test wants anyway.
  }
  stubLookups();
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("documentSaveReason", () => {
  test("the button says a file is required until there is one", () => {
    expect(documentSaveReason(false, undefined, false)).toBe("A file is required");
    expect(documentSaveReason(true, undefined, false)).toBeUndefined();
  });

  test("a file that is too big is a field that needs attention, not a missing file", () => {
    expect(documentSaveReason(true, "This file is 31 MB; the limit is 25 MB", false)).toBe("1 field needs attention");
  });

  test("saving outranks everything", () => {
    expect(documentSaveReason(false, undefined, true)).toBe("Saving…");
  });
});

describe("encodeRelatesTo / decodeRelatesTo", () => {
  test("round-trips a type and an id, and refuses a value that is neither", () => {
    expect(encodeRelatesTo({ type: "permit", id: "permit-9" })).toBe("permit:permit-9");
    expect(decodeRelatesTo("permit:permit-9")).toEqual({ type: "permit", id: "permit-9" });
    expect(decodeRelatesTo("permit:")).toBeNull();
    expect(decodeRelatesTo("nonsense")).toBeNull();
  });

  test("an id containing a colon survives -- only the FIRST colon separates", () => {
    expect(decodeRelatesTo("mom:a:b")).toEqual({ type: "mom", id: "a:b" });
  });
});

describe("DocumentUploadClient", () => {
  test("THE ACCEPTANCE: dropping DEWA_permit_2026.pdf names it and files it as a permit", async () => {
    const view = render(<DocumentUploadClient projectId="p1" projectName={PROJECT} />);

    const zone = view.getByText(DROP_ZONE_LABEL);
    const file = new File(["%PDF-1.7"], "DEWA_permit_2026.pdf", { type: "application/pdf" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("DEWA_permit_2026");
    });
    expect((view.getByLabelText("Category") as HTMLSelectElement).value).toBe("permit");
    // The file itself is acknowledged, with its size, under the zone.
    expect(view.getByText(/DEWA_permit_2026\.pdf/)).toBeTruthy();
  });

  test("the drop zone carries the item's exact words, and the picker filters to the allowed types", () => {
    const view = render(<DocumentUploadClient projectId="p1" projectName={PROJECT} />);

    expect(view.getByText("Drop a PDF, image or email here, or Choose File - up to 25 MB")).toBeTruthy();
    const input = view.container.querySelector("#document-file") as HTMLInputElement;
    expect(input.getAttribute("accept")).toBe(".pdf,image/*,.eml,.msg,.docx,.xlsx");
  });

  test("an over-size file is refused at the field, before any upload", async () => {
    const view = render(<DocumentUploadClient projectId="p1" projectName={PROJECT} />);
    const zone = view.getByText(DROP_ZONE_LABEL);

    const big = new File(["x"], "site-video.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 31 * 1024 * 1024 });
    fireEvent.drop(zone, { dataTransfer: { files: [big] } });

    await waitFor(() => expect(view.getByText("This file is 31 MB; the limit is 25 MB")).toBeTruthy());
  });

  test("an .eml is filed as email and its headers fill From / Received on / Subject", async () => {
    const view = render(<DocumentUploadClient projectId="p1" projectName={PROJECT} />);
    const zone = view.getByText(DROP_ZONE_LABEL);

    const eml = new File(
      [
        [
          "From: Sumeet Rao <sumeet@skylinebuilders.example>",
          "Subject: RE: DEWA connection approval",
          "Date: Sun, 10 May 2026 09:14:22 +0400",
          "",
          "Please find attached...",
        ].join("\r\n"),
      ],
      "FW Approval.eml",
      { type: "message/rfc822" }
    );
    fireEvent.drop(zone, { dataTransfer: { files: [eml] } });

    await waitFor(() => expect((view.getByLabelText("Category") as HTMLSelectElement).value).toBe("email"));
    await waitFor(() =>
      expect((view.getByLabelText("From") as HTMLInputElement).value).toBe("Sumeet Rao <sumeet@skylinebuilders.example>")
    );
    expect((view.getByLabelText("Received on") as HTMLInputElement).value).toBe("2026-05-10");
    expect((view.getByLabelText("Subject") as HTMLInputElement).value).toBe("RE: DEWA connection approval");
  });

  test("Relates to offers this project's own permits, RFIs and meetings, defaulting to the project", async () => {
    const view = render(<DocumentUploadClient projectId="p1" projectName={PROJECT} />);

    const select = view.getByLabelText("Relates to") as HTMLSelectElement;
    expect(select.value).toBe("project:p1");
    await waitFor(() => expect(select.querySelectorAll("option").length).toBe(4));
    const values = [...select.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(values).toEqual(["project:p1", "permit:permit-9", "rfi:rfi-3", "mom:mom-1"]);
  });

  test("a chosen relation and the owning project BOTH reach the API, and the server's words land in the band", async () => {
    const view = render(<DocumentUploadClient projectId="p1" projectName={PROJECT} />);
    const zone = view.getByText(DROP_ZONE_LABEL);
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["%PDF"], "DEWA_permit_2026.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("DEWA_permit_2026"));

    fireEvent.change(view.getByLabelText("Relates to"), { target: { value: "permit:permit-9" } });

    let sent: FormData | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = init?.body as FormData;
      return new Response(JSON.stringify({ error: "File storage is not configured on this server" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    fireEvent.click(view.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(view.getByText("File storage is not configured on this server")).toBeTruthy());
    const body = sent as unknown as FormData;
    expect(body.get("linkedEntityType")).toBe("permit");
    expect(body.get("linkedEntityId")).toBe("permit-9");
    // ...and the project the document belongs to, so it stays on this list.
    expect(body.get("projectId")).toBe("p1");
    expect(body.get("category")).toBe("permit");
    expect(body.get("name")).toBe("DEWA_permit_2026");
  });
});
