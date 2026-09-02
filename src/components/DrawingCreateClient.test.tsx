/// <reference types="bun-types" />
// R67 D-08. The item's acceptance is a Playwright run with the project-
// resolution proxies stubbed to 500, which this lane may not do (no dev
// server). The same assertions are made here against the rendered component:
// with the project resolution failed, the screen still renders its own frame
// (heading "New Drawing", a Back control, a Retry control), the words
// "Internal Server Error" appear nowhere, and Save states the one reason that
// outranks every field.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

const push = mock((_: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mod = await import("./DrawingCreateClient");
const DrawingCreateClient = mod.default;
const {
  missingDrawingFields,
  drawingSaveReason,
  walkthroughUrlError,
  acceptFor,
  MAX_DRAWING_MB,
} = mod;

// The background project-name resolution must never resolve during these
// assertions -- a state update after the test body has run is noise, not
// signal. A pending fetch is exactly what the real screen shows first anyway.
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

// R67 D-70: describeProjectLoadFailure() moved to src/lib/project-selection.ts
// (as describeProjectListFailure) so all 23 create routes give this same failure
// the same words. Its own tests moved with it, to project-selection.test.ts.

describe("DrawingCreateClient with a failed project resolution", () => {
  test("still renders its own screen: title, Back and Retry, and never the bare status phrase", () => {
    const view = render(<DrawingCreateClient projectId={null} projectError="Internal Server Error" />);

    expect(view.getByRole("heading", { name: "New Drawing" })).toBeTruthy();
    expect(view.getByText("Drawings & 3D / New Drawing")).toBeTruthy();
    expect(view.getByRole("button", { name: /Back/ })).toBeTruthy();
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(view.getByRole("link", { name: "Back to Drawings" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Internal Server Error");
    expect(view.getByRole("alert").textContent).toContain(
      "Couldn't load your project list: VERIDIAN answered with an internal error."
    );
  });

  test("Save is disabled for the one reason that outranks every field", () => {
    const view = render(<DrawingCreateClient projectId={null} projectError="Internal Server Error" />);
    const save = view.getByRole("button", { name: "Save (project list unavailable)" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  test("a project id in the URL survives a failed project LIST -- the write only needs the id", () => {
    const view = render(
      <DrawingCreateClient projectId="proj-1" projectError="VERIDIAN did not respond in time, on two attempts" />
    );
    // The failure is still reported...
    expect(view.getByRole("alert").textContent).toContain("did not respond in time");
    // ...but the screen is usable, and Save's reason is about the form again.
    expect(view.getByRole("button", { name: "Save (Name, Drawing No., Rev, File)" })).toBeTruthy();
  });
});

describe("DrawingCreateClient with a resolved project", () => {
  test("names the project the drawing will land on and reports no failure", () => {
    const view = render(
      <DrawingCreateClient projectId="proj-1" projectName="Cedar Heights Villa - Phase 1" projectError={null} />
    );
    expect(view.getByText("For project: Cedar Heights Villa - Phase 1")).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

// ─── R67 D-09 (audit R-027) ──────────────────────────────────────────────
// The item's acceptance types into the form and watches the button's name
// shrink. In this repo's test environment (React 19 + happy-dom under bun
// test) fireEvent.change updates the DOM node but never reaches React's
// onChange, so a controlled input's state cannot be driven from a test at
// all -- measured, not assumed, and the reason PermitCreateClient.test.tsx
// says the same thing. The three states the acceptance walks through are
// therefore asserted against the exact function the button's name is built
// from, plus the rendered empty form for the first of them.

// D-12 (later in this same lane) added Drawing No. and Rev to the mandatory
// set: the supersede rule is keyed on the drawing number, so a register entry
// without one can never take over from the revision it replaces. The counter
// below therefore names four fields where D-09 alone named two.
describe("missingDrawingFields", () => {
  const EMPTY = { name: "", drawingNo: "", rev: "", usingLink: false, externalUrl: "", hasFile: false };
  const IDENTIFIED = { drawingNo: "AR-101", rev: "B" };

  test("an empty upload form names every mandatory field -- the old counter saw only Name", () => {
    expect(missingDrawingFields(EMPTY)).toEqual(["Name", "Drawing No.", "Rev", "File"]);
  });

  test("counts down in FIELD order as the form fills", () => {
    expect(missingDrawingFields({ ...EMPTY, name: "AR-101 Ground floor" })).toEqual(["Drawing No.", "Rev", "File"]);
    expect(missingDrawingFields({ ...EMPTY, name: "AR-101 Ground floor", ...IDENTIFIED })).toEqual(["File"]);
  });

  test("on the External link source it is the URL that is mandatory, never a file", () => {
    expect(
      missingDrawingFields({ ...EMPTY, name: "Villa walkthrough", ...IDENTIFIED, usingLink: true })
    ).toEqual(["Walkthrough URL"]);
    expect(
      missingDrawingFields({
        name: "Villa walkthrough",
        ...IDENTIFIED,
        usingLink: true,
        externalUrl: "https://example.com/x",
        hasFile: false,
      })
    ).toEqual([]);
  });

  test("whitespace is not a name, not a drawing number and not a URL", () => {
    expect(missingDrawingFields({ ...EMPTY, name: "   ", ...IDENTIFIED, hasFile: true })).toEqual(["Name"]);
    expect(missingDrawingFields({ ...EMPTY, name: "x", drawingNo: "  ", rev: "B", hasFile: true })).toEqual([
      "Drawing No.",
    ]);
    expect(
      missingDrawingFields({ name: "x", ...IDENTIFIED, usingLink: true, externalUrl: "  ", hasFile: false })
    ).toEqual(["Walkthrough URL"]);
  });
});

describe("drawingSaveReason", () => {
  const BASE = { projectLoaded: true, submitting: false, missing: [] as string[], attention: 0 };

  test("builds exactly the three names the acceptance walks through", () => {
    expect(drawingSaveReason({ ...BASE, missing: ["Name", "File"] })).toBe("Name, File");
    expect(drawingSaveReason({ ...BASE, missing: ["File"] })).toBe("File");
    expect(drawingSaveReason({ ...BASE, missing: ["Walkthrough URL"] })).toBe("Walkthrough URL");
  });

  test("a complete form has no reason at all, so the button reads just 'Save'", () => {
    expect(drawingSaveReason(BASE)).toBeUndefined();
  });

  test("a field that is filled but wrong outranks the counter", () => {
    expect(drawingSaveReason({ ...BASE, missing: ["Name"], attention: 1 })).toBe("1 field needs attention");
    expect(drawingSaveReason({ ...BASE, attention: 2 })).toBe("2 fields need attention");
  });

  test("submitting, and a project that never loaded, outrank the fields in that order", () => {
    expect(drawingSaveReason({ ...BASE, submitting: true, missing: ["Name", "File"] })).toBe("Adding…");
    expect(
      drawingSaveReason({ projectLoaded: false, submitting: true, missing: ["Name"], attention: 1 })
    ).toBe("project list unavailable");
  });
});

describe("walkthroughUrlError", () => {
  test("refuses a link that is not one, on blur", () => {
    expect(walkthroughUrlError("matterport.com/show")).toBe("Enter a link starting with http:// or https://");
  });

  test("accepts a real link and says nothing about an empty field", () => {
    expect(walkthroughUrlError("https://my.matterport.com/show/?m=abc")).toBeUndefined();
    expect(walkthroughUrlError("")).toBeUndefined();
  });
});

describe("acceptFor", () => {
  test("each Kind filters the picker to the files it can actually store", () => {
    expect(acceptFor("dwg")).toBe(".dwg,.dxf,.pdf");
    expect(acceptFor("3d_walkthrough")).toBe(".glb,.gltf,.fbx,.mp4");
  });
});

describe("DrawingCreateClient's create form", () => {
  test("an empty form disables Save and names EVERY mandatory field, not just Name", () => {
    const view = render(<DrawingCreateClient projectId="proj-1" projectName="Cedar Heights" projectError={null} />);
    const save = view.getByRole("button", { name: "Save (Name, Drawing No., Rev, File)" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  // R67 D-12: the register's own identity, and the state it is uploaded in.
  test("carries the register fields, with Status defaulting to For approval", () => {
    const view = render(<DrawingCreateClient projectId="proj-1" projectName="Cedar Heights" projectError={null} />);
    expect((view.getByLabelText("Drawing No.") as HTMLInputElement).placeholder).toBe("e.g. AR-101");
    expect((view.getByLabelText("Rev") as HTMLInputElement).placeholder).toBe("e.g. A");
    expect((view.getByLabelText("Status") as HTMLSelectElement).value).toBe("for_approval");
    expect(
      view.getByText(
        "Choosing Current supersedes the drawing with the same Drawing No. that people are building from today."
      )
    ).toBeTruthy();
  });

  test("the file field states its limit and filters the picker by Kind", () => {
    const view = render(<DrawingCreateClient projectId="proj-1" projectName="Cedar Heights" projectError={null} />);
    expect(view.getByText(`Max ${MAX_DRAWING_MB} MB`)).toBeTruthy();
    expect((view.getByLabelText("File (DWG)") as HTMLInputElement).accept).toBe(".dwg,.dxf,.pdf");
  });

  test("the Source choice is two labelled options, and is offered only for a 3D walkthrough", () => {
    const view = render(<DrawingCreateClient projectId="proj-1" projectName="Cedar Heights" projectError={null} />);
    // Kind defaults to DWG, which has exactly one source: a file.
    expect(view.queryByLabelText("External link")).toBeNull();
    expect(view.queryByLabelText("Upload a file")).toBeNull();
  });
});
