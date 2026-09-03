/// <reference types="bun-types" />
// R67 D-18 (R-049). The audit recorded requiredMarks=0 on this form and an
// empty Date & time field on a screen whose meeting is usually happening right
// now, with a Save button that would not press and never said why.
//
// R67 INTEGRATION TRAIN. D-18 and D-67 both rewrote this form. D-67's
// CreateScreen archetype won the SHAPE (decision D-11's rule of thumb) and
// D-18's capabilities were folded onto it, so these assertions are rewritten
// against the archetype's own conventions rather than deleted. What moved:
//
//   * Required-ness is marked by its ABSENCE of "(optional)" and by the field's
//     name appearing in the primary's label -- R-257's rule, which the
//     archetype implements once for every create screen. The old
//     "Title (required)" label text and per-control aria-required are gone as
//     a MECHANISM, not as a behaviour: "Save (Title)" still names exactly what
//     is missing, which is the fault D-18 recorded.
//   * The zone hint is the field's `help` node, still naming a real zone.
//   * There is no separate "← Back" control; the archetype's breadcrumb owns
//     Back, and Cancel is asserted on its own.
//
// SCOPE, unchanged and still narrower than the item's wording: everything here
// is what the form renders at first paint. The "type a title, watch the
// primary rename itself" half is asserted in src/lib/mom-form.test.ts against
// missingMeetingFields() -- because a simulated keystroke into a CONTROLLED
// text input does not reach React's onChange under this repo's bun +
// @happy-dom/global-registrator + React 19 harness. That was verified, not
// assumed. See mom-form.ts's own header.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard PayrollClient.test.tsx documents.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => { pushed.push(href); },
    replace: (href: string) => { pushed.push(href); },
  }),
}));

const MoMCreateClient = (await import("./MoMCreateClient")).default;

afterEach(() => {
  cleanup();
  pushed.length = 0;
});

describe("MoMCreateClient at rest (D-18 on the D-67 archetype)", () => {
  test("the primary is named 'Save (Title)' and is disabled -- Date & time is already filled in, so it is not in the list", async () => {
    const { getByRole } = render(<MoMCreateClient projectId="proj-1" projectName="Cedar Heights" />);
    await waitFor(() => {
      const save = getByRole("button", { name: "Save (Title)" }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
    });
  });

  test("the two mandatory fields are the only ones NOT marked optional -- the recorded fault was requiredMarks=0", async () => {
    const { container } = render(<MoMCreateClient projectId="proj-1" projectName="Cedar Heights" />);
    await waitFor(() => expect(container.querySelector("label[for='title']")).not.toBeNull());

    const optional = (name: string) =>
      (container.querySelector(`label[for='${name}']`)?.textContent ?? "").includes("(optional)");

    expect(optional("title")).toBe(false);
    expect(optional("scheduledAt")).toBe(false);
    // ...and the three D-18 added ARE optional, which is the archetype's way
    // of saying so: the word, not an asterisk.
    expect(optional("meetingType")).toBe(true);
    expect(optional("attendees")).toBe(true);
    expect(optional("agenda")).toBe(true);
  });

  test("Date & time is pre-filled to a real quarter hour, and the zone it was computed in is named under the field", async () => {
    const { container, getByText } = render(<MoMCreateClient projectId="proj-1" projectName="Cedar Heights" />);
    await waitFor(() => {
      const input = container.querySelector("#scheduledAt") as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45)$/);
    });
    // A pre-filled time nobody can attribute to a zone is the failure this
    // closes; the hint always names one.
    expect(getByText(/^Times are in \S/)).toBeDefined();
  });

  test("Title carries the example placeholder", async () => {
    const { container } = render(<MoMCreateClient projectId="proj-1" projectName="Cedar Heights" />);
    await waitFor(() => expect(container.querySelector("#title")).not.toBeNull());
    expect((container.querySelector("#title") as HTMLInputElement).placeholder).toBe("e.g. Weekly site review");
  });

  test("Type, Attendees and Agenda are on the create form at all -- they used to exist only in Edit mode", async () => {
    const { container } = render(<MoMCreateClient projectId="proj-1" projectName="Cedar Heights" />);
    await waitFor(() => expect(container.querySelector("#attendees")).not.toBeNull());
    expect(container.querySelector("#agenda")).not.toBeNull();
    expect(container.querySelector("#meetingType")).not.toBeNull();
    // The Type field opens on a real default, not on an empty select -- every
    // meeting had to be a type, and "team" is the one the API already defaults
    // to, so the control and the server agree.
    expect((container.querySelector("#meetingType") as HTMLSelectElement).value).toBe("team");
  });

  test("the screen names the project it is about to write into (D-20)", async () => {
    const { getByText } = render(<MoMCreateClient projectId="proj-1" projectName="Cedar Heights" />);
    await waitFor(() => expect(getByText("Cedar Heights")).toBeDefined());
  });

  test("the form states what happens after Save", async () => {
    const { getByText } = render(<MoMCreateClient projectId="proj-1" projectName="Cedar Heights" />);
    await waitFor(() =>
      expect(getByText("After saving you will type the minutes on the meeting page.")).toBeDefined()
    );
  });

  test("Cancel returns to this project's meeting list", async () => {
    const { getByRole } = render(<MoMCreateClient projectId="proj-1" projectName="Cedar Heights" />);
    await waitFor(() => expect(getByRole("button", { name: "Cancel" })).toBeDefined());

    fireEvent.click(getByRole("button", { name: "Cancel" }));
    expect(pushed).toEqual(["/moms?projectId=proj-1"]);
  });
});
