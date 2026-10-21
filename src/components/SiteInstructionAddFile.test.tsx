/// <reference types="bun-types" />
// R-C14: the "Add file" action on a site instruction's page. Chooses a file, posts it to /api/site-instructions/[id]/file, says what was
// stored, and shows the server's refusal text as it is. A bad file type never reaches the network.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { SiteInstructionAddFile } from "./SiteInstructionViews";

// the guide panel navigates with the app router
mock.module("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }), usePathname: () => "/site-instructions/si1", useSearchParams: () => new URLSearchParams() }));

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; hasFile: boolean; fields: Record<string, unknown> }>;
let reply: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  reply = { status: 201, body: { fileName: "si.pdf" } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const f = init?.body as FormData | undefined;
    calls.push({ url: String(input), hasFile: f?.get("file") instanceof File, fields: f ? Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === "string")) : {} });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const choose = (view: ReturnType<typeof render>, name: string) =>
  fireEvent.change(view.getByLabelText(/Add file/), { target: { files: [new File(["x"], name, { type: "application/pdf" })] } });

describe("SiteInstructionAddFile", () => {
  test("pressing Add file with no file chosen sends nothing and the guide panel says to choose one; then a file is posted and said to be added", async () => {
    const view = render(<SiteInstructionAddFile id="si 1" />);
    const button = view.getByTestId("si-add-file-button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => view.getByTestId("guided-error"));
    expect(view.getByTestId("guided-error-what").textContent).toContain("Choose the PDF or photo");
    expect(calls).toEqual([]);
    choose(view, "si.pdf");
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(view.getByTestId("si-add-file-note").getAttribute("data-ok")).toBe("1"));
    expect(view.getByTestId("si-add-file-note").textContent).toBe("Added si.pdf to this instruction");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/documents");
    expect(calls[0]!.hasFile).toBe(true);
    expect(calls[0]!.fields).toMatchObject({ name: "si.pdf", category: "site_instruction", linkedEntityType: "construction_site_instruction", linkedEntityId: "si 1" });
  });

  test("the server's refusal is shown (the server's words kept) and the file stays chosen", async () => {
    reply = { status: 403, body: { error: "Your role cannot add files to site instructions" } };
    const view = render(<SiteInstructionAddFile id="si1" />);
    choose(view, "si.pdf");
    fireEvent.click(view.getByTestId("si-add-file-button"));
    await waitFor(() => view.getByTestId("guided-error"));
    expect(view.getByTestId("guided-error-what").textContent).toContain("Your role cannot add files to site instructions");
  });

  test("a file that is not a PDF or photo is stopped in the browser; nothing is sent", () => {
    const view = render(<SiteInstructionAddFile id="si1" />);
    choose(view, "notes.exe");
    expect((view.getByTestId("si-add-file-button") as HTMLButtonElement).disabled).toBe(false);
    expect(view.getByRole("alert").textContent).toContain("PDF or a photo");
    fireEvent.click(view.getByTestId("si-add-file-button"));
    expect(calls).toEqual([]);
  });
});
