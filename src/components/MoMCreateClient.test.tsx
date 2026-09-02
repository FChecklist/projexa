/// <reference types="bun-types" />
// R67 D-18 (R-049). The audit recorded requiredMarks=0 on this form and an
// empty Date & time field on a screen whose meeting is usually happening right
// now, with a Save button that would not press and never said why.
//
// SCOPE OF THIS FILE, stated because it is deliberately narrower than the
// item's acceptance wording: everything asserted here is what the form renders
// at first paint. The "type a title, watch the primary rename itself" half is
// asserted in src/lib/mom-form.test.ts against missingMeetingFields(), the
// exact function this component calls -- because a simulated keystroke into a
// CONTROLLED text input does not reach React's onChange under this repo's
// bun + @happy-dom/global-registrator + React 19 harness. That was verified,
// not assumed: React's onClick, onInput, onFocus/onBlur, <select> onChange and
// checkbox onChange all fire under fireEvent here, while onChange on
// <input type="text"> and <textarea> never does -- with fireEvent.change,
// fireEvent.input, or a raw dispatchEvent, and with or without React's value
// tracker cleared first. See mom-form.ts's own header.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard PayrollClient.test.tsx documents.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({ useRouter: () => ({ push: (href: string) => { pushed.push(href); } }) }));

const MoMCreateClient = (await import("./MoMCreateClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch() {
  // The real /api/organization shape today: no timezone field, because
  // PROJEXA's organizations table has no such column yet.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/organization")) return jsonRes({ organization: { id: "o1", name: "Skyline", slug: "skyline" }, role: "pm" });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  pushed.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("MoMCreateClient at rest (D-18)", () => {
  test("the primary is named 'Save (Title)' and is disabled -- Date & time is already filled in, so it is not in the list", async () => {
    stubFetch();
    const { getByRole } = render(<MoMCreateClient projectId="proj-1" />);
    await waitFor(() => {
      const save = getByRole("button", { name: "Save (Title)" }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
    });
  });

  test("both mandatory fields say they are mandatory -- the recorded fault was requiredMarks=0", async () => {
    stubFetch();
    const { getByLabelText } = render(<MoMCreateClient projectId="proj-1" />);
    await waitFor(() => expect(getByLabelText("Title (required)")).toBeDefined());
    expect(getByLabelText("Date & time (required)")).toBeDefined();
    expect(getByLabelText("Title (required)").getAttribute("aria-required")).toBe("true");
    expect(getByLabelText("Date & time (required)").getAttribute("aria-required")).toBe("true");
  });

  test("Date & time is pre-filled to a real quarter hour, and the zone it was computed in is named under the field", async () => {
    stubFetch();
    const { getByLabelText, getByText } = render(<MoMCreateClient projectId="proj-1" />);
    await waitFor(() => {
      const value = (getByLabelText("Date & time (required)") as HTMLInputElement).value;
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45)$/);
    });
    // A pre-filled time nobody can attribute to a zone is the failure this
    // closes; the hint always names one.
    expect(getByText(/^Times are in \S/)).toBeDefined();
  });

  test("Title carries the example placeholder", async () => {
    stubFetch();
    const { getByLabelText } = render(<MoMCreateClient projectId="proj-1" />);
    await waitFor(() => expect(getByLabelText("Title (required)")).toBeDefined());
    expect((getByLabelText("Title (required)") as HTMLInputElement).placeholder).toBe("e.g. Weekly Site Coordination - Villa 21");
  });

  test("Type, Attendees and Agenda are on the create form at all -- they used to exist only in Edit mode", async () => {
    stubFetch();
    const { getByLabelText, getByText } = render(<MoMCreateClient projectId="proj-1" />);
    await waitFor(() => expect(getByLabelText("Attendees")).toBeDefined());
    expect(getByLabelText("Agenda")).toBeDefined();
    expect(getByText("Type")).toBeDefined();
  });

  test("blurring the empty Title shows the field message -- onBlur is a React handler this harness can drive", async () => {
    stubFetch();
    const { getByLabelText, getAllByText } = render(<MoMCreateClient projectId="proj-1" />);
    await waitFor(() => expect(getByLabelText("Title (required)")).toBeDefined());

    fireEvent.blur(getByLabelText("Title (required)"));
    // Twice on purpose: under the field AND in the persistent footer message
    // band, which is where GLOBAL says a message lives instead of a toast.
    await waitFor(() => expect(getAllByText("Enter a meeting title, e.g. Weekly Site Coordination").length).toBe(2));
  });

  test("the form states what happens after Save", async () => {
    stubFetch();
    const { getByText } = render(<MoMCreateClient projectId="proj-1" />);
    await waitFor(() => expect(getByText("After saving you will type the minutes on the meeting page.")).toBeDefined());
  });

  test("Cancel and Back both return to this project's meeting list", async () => {
    stubFetch();
    const { getByRole, getByText } = render(<MoMCreateClient projectId="proj-1" />);
    await waitFor(() => expect(getByRole("button", { name: "Cancel" })).toBeDefined());

    fireEvent.click(getByRole("button", { name: "Cancel" }));
    fireEvent.click(getByText("← Back"));
    expect(pushed).toEqual(["/moms?projectId=proj-1", "/moms?projectId=proj-1"]);
  });
});
