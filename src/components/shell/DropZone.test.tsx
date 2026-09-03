/// <reference types="bun-types" />
// R67 WS-C (C-07) -- THE ATTACH CONTROL, ASSERTED IN A REAL RENDER.
//
// attachments.test.ts fixes the SENTENCES; this file fixes the three things a
// pure function cannot show:
//
//   1. the button is a WORD and the limits are IN the word;
//   2. picking an over-size file puts C-07's exact refusal on the chip,
//      before any bytes move -- the harness below wires onAdd to the same
//      checkBatch() M24Shell wires it to, so this is the real path;
//   3. an upload in flight shows real progress and a Cancel, and a storage
//      failure says so with a Retry rather than a false success.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
// The module-level `screen` helper binds to document.body at IMPORT time,
// before GlobalRegistrator has made one, so every query goes through
// render()'s own returned queries.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { DropZone, type AttachedFile } from "./DropZone";
import { MB, checkBatch } from "@/lib/attachments";
import { PERMITS_CARD } from "@/lib/card-catalogue";

afterEach(cleanup);

const POLICY = PERMITS_CARD.attach!;

/** A File whose reported size is whatever the test needs, without the bytes. */
function fakeFile(name: string, size: number): File {
  const file = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/**
 * The same wiring M24Shell uses: the browser hands files in, checkBatch
 * decides, and the chip shows the verdict. Testing DropZone with a
 * hand-written error would prove nothing about the path a user takes.
 */
function Harness() {
  const [files, setFiles] = useState<AttachedFile[]>([]);
  return (
    <DropZone
      policy={POLICY}
      files={files}
      onAdd={(incoming) => {
        const accepted = files.filter((f) => !f.error).length;
        const checked = checkBatch(
          incoming.map((f) => ({ name: f.name, size: f.size })),
          POLICY,
          accepted
        );
        setFiles((prev) => [
          ...prev,
          ...checked.map((result, i) => ({
            id: `${prev.length + i}`,
            name: incoming[i].name,
            size: incoming[i].size,
            status: (result.error ? "error" : "ready") as AttachedFile["status"],
            progress: 0,
            error: result.error ?? undefined,
          })),
        ]);
      }}
      onRemove={(id) => setFiles((prev) => prev.filter((f) => f.id !== id))}
    />
  );
}

describe("the attach control", () => {
  test("is a word, and the limits are in the word", () => {
    const view = render(<Harness />);
    expect(view.getByRole("button", { name: "Attach PDF, up to 25 MB" })).toBeTruthy();
  });

  test("the file input is filtered to the module's own accept list", () => {
    const view = render(<Harness />);
    const input = view.container.querySelector("input[type=file]") as HTMLInputElement;
    expect(input.getAttribute("accept")).toBe(".pdf");
  });
});

describe("an over-size file", () => {
  test("C-07's acceptance: the chip reads 'Too large: 30 MB, limit 25 MB'", () => {
    const view = render(<Harness />);
    const input = view.container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fakeFile("huge.pdf", 30 * MB)] } });
    expect(view.getByText("Too large: 30 MB, limit 25 MB")).toBeTruthy();
  });

  test("a valid PDF is accepted, and the chip carries its name and its size", () => {
    const view = render(<Harness />);
    const input = view.container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fakeFile("DEWA-permit.pdf", 2 * MB)] } });
    expect(view.getByText("DEWA-permit.pdf")).toBeTruthy();
    expect(view.getByText("2 MB")).toBeTruthy();
    expect(view.queryByText(/Too large/)).toBeNull();
  });

  test("the wrong type is refused in words, naming what to attach instead", () => {
    const view = render(<Harness />);
    const input = view.container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fakeFile("notes.docx", 1000)] } });
    expect(view.getByText("Wrong type: .docx — attach a PDF")).toBeTruthy();
  });

  test("a rejected chip can be removed, so the tray is never stuck", () => {
    const view = render(<Harness />);
    const input = view.container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fakeFile("huge.pdf", 30 * MB)] } });
    fireEvent.click(view.getByLabelText("Remove huge.pdf"));
    expect(view.queryByText("Too large: 30 MB, limit 25 MB")).toBeNull();
  });
});

describe("an upload in flight", () => {
  const uploading: AttachedFile[] = [
    { id: "a", name: "boq.xlsx", size: 2 * MB, status: "uploading", progress: 42 },
  ];

  test("shows real progress and offers Cancel", () => {
    const cancelled: string[] = [];
    const view = render(
      <DropZone
        policy={POLICY}
        files={uploading}
        onAdd={() => {}}
        onRemove={() => {}}
        onCancel={(id) => cancelled.push(id)}
      />
    );
    expect(view.getByText("42%")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(cancelled).toEqual(["a"]);
  });

  test("a file being uploaded cannot be removed out from under its own request", () => {
    const view = render(
      <DropZone policy={POLICY} files={uploading} onAdd={() => {}} onRemove={() => {}} onCancel={() => {}} />
    );
    expect(view.queryByLabelText("Remove boq.xlsx")).toBeNull();
  });
});

describe("a storage failure", () => {
  test("says so, with a Retry -- never a false success and never a bare 500", () => {
    let retried = 0;
    const view = render(
      <DropZone
        policy={POLICY}
        files={[]}
        onAdd={() => {}}
        onRemove={() => {}}
        storageError="Uploads are unavailable right now"
        onRetry={() => {
          retried += 1;
        }}
      />
    );
    expect(view.getByRole("alert").textContent).toContain("Uploads are unavailable right now");
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(retried).toBe(1);
  });
});
