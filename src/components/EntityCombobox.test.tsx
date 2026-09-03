/// <reference types="bun-types" />
// R67 D-80 acceptance.
//
// The item's acceptance is a Playwright walk against http://localhost:3100
// ("with exactly one worker in the roster, /labour/attendance/new opens with the
// Worker field showing that name and Save enabled after Date is set; log time
// for task T twice -> on the second visit the Task field already shows T with
// no click; typing 'mas' in the Worker field and pressing Enter selects the
// first match"). This session may not start a dev server, so the same three
// behaviours are asserted here.
//
// MEASURED ENVIRONMENT LIMIT, stated rather than implied: this environment does
// not deliver input/change events to React, so NO test in this repo can type
// into a field (measured with a minimal controlled-input harness in an earlier
// session; clicks and keyboard events DO work). The two behaviours that need no
// typing -- "a list of one is already answered" and "the last choice comes
// back" -- are asserted against the real DOM below. The typing half is asserted
// through the exported pure functions the keyboard handler itself calls:
// filterOptions() is literally what "typing 'mas'" produces, and nextHighlight()
// is what the arrow keys produce. A browser walk is still owed for the
// keystroke-to-Enter path end to end.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const mod = await import("./EntityCombobox");
const EntityCombobox = mod.default;
const { filterOptions, nextHighlight, resolveInitialValue } = mod;

const WORKERS = [
  { value: "r1", label: "Masood Alam", hint: "EMP-001 · Mason" },
  { value: "r2", label: "Bilal Khan", hint: "EMP-002 · Carpenter" },
  { value: "r3", label: "Chandra Rao", hint: "EMP-003 · Mason" },
];

afterEach(cleanup);

describe("filterOptions (what typing produces)", () => {
  test("typing 'mas' matches by NAME, case-insensitively, and the FIRST match is the one Enter takes", () => {
    // Two rows match: "Masood Alam" by name, "Chandra Rao" by the trade in its
    // hint. D-80's acceptance is that Enter takes the FIRST of them.
    expect(filterOptions(WORKERS, "mas").map((o) => o.label)).toEqual(["Masood Alam", "Chandra Rao"]);
    expect(filterOptions(WORKERS, "MAS")[0].label).toBe("Masood Alam");
  });

  test("the hint is searched too, so an ID or a trade finds the person", () => {
    expect(filterOptions(WORKERS, "EMP-002").map((o) => o.label)).toEqual(["Bilal Khan"]);
    expect(filterOptions(WORKERS, "mason").map((o) => o.label)).toEqual(["Masood Alam", "Chandra Rao"]);
  });

  test("an empty or whitespace query is not a filter", () => {
    expect(filterOptions(WORKERS, "")).toHaveLength(3);
    expect(filterOptions(WORKERS, "   ")).toHaveLength(3);
  });

  test("no match returns an empty list, which is what the 'No match' row renders from", () => {
    expect(filterOptions(WORKERS, "zzz")).toEqual([]);
  });
});

describe("nextHighlight (what the arrow keys produce)", () => {
  test("from nothing, Down takes the first and Up takes the last", () => {
    expect(nextHighlight(-1, 3, 1)).toBe(0);
    expect(nextHighlight(-1, 3, -1)).toBe(2);
  });

  test("it wraps at both ends -- a list you cannot get back to the top of needs a mouse", () => {
    expect(nextHighlight(2, 3, 1)).toBe(0);
    expect(nextHighlight(0, 3, -1)).toBe(2);
  });

  test("an empty list has NO highlight, never index 0 of nothing", () => {
    expect(nextHighlight(-1, 0, 1)).toBe(-1);
    expect(nextHighlight(0, 0, 1)).toBe(-1);
  });
});

describe("resolveInitialValue (D-80's preselection rule)", () => {
  test("a list of exactly one is already answered", () => {
    expect(resolveInitialValue([WORKERS[0]], "", null)).toBe("r1");
  });

  test("the remembered choice comes back when the list still has it", () => {
    expect(resolveInitialValue(WORKERS, "", "r2")).toBe("r2");
  });

  test("a remembered choice that has LEFT the list is not silently re-selected", () => {
    // The worker was deactivated; the picker opens empty rather than naming
    // somebody who is no longer on the roster.
    expect(resolveInitialValue(WORKERS, "", "r-gone")).toBe("");
  });

  test("what the user has already chosen wins over both", () => {
    expect(resolveInitialValue([WORKERS[0]], "r3", "r2")).toBe("r3");
    expect(resolveInitialValue(WORKERS, "r3", "r2")).toBe("r3");
  });

  test("nothing to go on means nothing is chosen", () => {
    expect(resolveInitialValue(WORKERS, "", null)).toBe("");
    expect(resolveInitialValue([], "", "r1")).toBe("");
  });
});

describe("EntityCombobox in the DOM", () => {
  test("a list of ONE preselects it, displays it, and reports it up so the Save label is right on the first paint", async () => {
    const changes: string[] = [];
    const { getByLabelText } = render(
      <EntityCombobox
        aria-label="Worker"
        options={[WORKERS[0]]}
        value=""
        onChange={(v) => changes.push(v)}
      />
    );
    await waitFor(() => expect(changes).toEqual(["r1"]));
    // And once the parent hands the value back, the field shows the name.
    cleanup();
    const { getByLabelText: get2 } = render(
      <EntityCombobox aria-label="Worker" options={[WORKERS[0]]} value="r1" onChange={() => {}} />
    );
    expect((get2("Worker") as HTMLInputElement).value).toBe("Masood Alam");
    void getByLabelText;
  });

  test("a list of MANY preselects nothing on its own", async () => {
    const changes: string[] = [];
    render(<EntityCombobox aria-label="Worker" options={WORKERS} value="" onChange={(v) => changes.push(v)} />);
    // Give the preselect effect a chance to run and prove it did not fire.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(changes).toEqual([]);
  });

  test("the last choice is offered back with no click", async () => {
    const changes: string[] = [];
    render(
      <EntityCombobox aria-label="Task" options={WORKERS} value="" storedValue="r2" onChange={(v) => changes.push(v)} />
    );
    await waitFor(() => expect(changes).toEqual(["r2"]));
  });

  test("a remembered option that is no longer in the list leaves the field empty", async () => {
    const changes: string[] = [];
    render(
      <EntityCombobox aria-label="Worker" options={WORKERS} value="" storedValue="r-gone" onChange={(v) => changes.push(v)} />
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(changes).toEqual([]);
  });

  test("while the list is loading the field says so and cannot be typed into", () => {
    const { getByLabelText } = render(
      <EntityCombobox aria-label="Worker" options={[]} value="" loading onChange={() => {}} />
    );
    const input = getByLabelText("Worker") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Loading…");
  });

  test("focus opens the list, and an option is a real, clickable option row", async () => {
    const changes: string[] = [];
    const { getByLabelText, getAllByRole } = render(
      <EntityCombobox aria-label="Worker" options={WORKERS} value="" onChange={(v) => changes.push(v)} />
    );
    fireEvent.focus(getByLabelText("Worker"));
    await waitFor(() => expect(getAllByRole("option")).toHaveLength(3));
    fireEvent.mouseDown(getAllByRole("option")[1]);
    expect(changes).toEqual(["r2"]);
  });

  test("ArrowDown then Enter takes the highlighted option -- no mouse anywhere", async () => {
    const changes: string[] = [];
    const { getByLabelText } = render(
      <EntityCombobox aria-label="Worker" options={WORKERS} value="" onChange={(v) => changes.push(v)} />
    );
    const input = getByLabelText("Worker");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(changes).toEqual(["r2"]);
  });

  test("Enter on an untouched, unfiltered list selects NOTHING -- the picker does not guess", () => {
    // Nothing was typed, so there is no "top match" -- only whichever row
    // happens to sort first, and selecting that is how a wrong worker gets a
    // day's pay.
    const changes: string[] = [];
    const { getByLabelText } = render(
      <EntityCombobox aria-label="Worker" options={WORKERS} value="" onChange={(v) => changes.push(v)} />
    );
    const input = getByLabelText("Worker");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(changes).toEqual([]);
  });

  test("the listbox's OWN children are the options -- nothing sits between them", async () => {
    // A listbox's owned children must be the options themselves. With an
    // unrelated wrapper in between (the original shape put role="option" on a
    // <button> inside a plain <li>), a screen reader does not report the option
    // set or which one is selected -- which would make this picker, added
    // specifically for keyboard and type-ahead use, unusable by the people who
    // most need it.
    const { getByLabelText, getByRole, getAllByRole } = render(
      <EntityCombobox aria-label="Worker" options={WORKERS} value="" onChange={() => {}} />
    );
    fireEvent.focus(getByLabelText("Worker"));
    await waitFor(() => expect(getAllByRole("option")).toHaveLength(3));

    const listbox = getByRole("listbox");
    expect(listbox.querySelectorAll(":scope > [role=option]").length).toBe(3);
    // ...and no option is nested inside another element within the listbox.
    expect(listbox.querySelectorAll("[role=option] [role=option]").length).toBe(0);
  });

  test("the arrow-key highlight is announced through aria-activedescendant", async () => {
    const { getByLabelText, getAllByRole } = render(
      <EntityCombobox aria-label="Worker" options={WORKERS} value="" onChange={() => {}} />
    );
    const input = getByLabelText("Worker");
    fireEvent.focus(input);
    await waitFor(() => expect(getAllByRole("option")).toHaveLength(3));
    // Nothing highlighted yet: nothing to point at.
    expect(input.getAttribute("aria-activedescendant")).toBeNull();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = input.getAttribute("aria-activedescendant");
    expect(active).not.toBeNull();
    expect(document.getElementById(active!)?.getAttribute("role")).toBe("option");
    expect(document.getElementById(active!)?.textContent).toContain("Masood Alam");
  });

  test("Escape closes the list without selecting anything", async () => {
    const changes: string[] = [];
    const { getByLabelText, queryAllByRole } = render(
      <EntityCombobox aria-label="Worker" options={WORKERS} value="" onChange={(v) => changes.push(v)} />
    );
    const input = getByLabelText("Worker");
    fireEvent.focus(input);
    await waitFor(() => expect(queryAllByRole("option")).toHaveLength(3));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(queryAllByRole("option")).toHaveLength(0));
    expect(changes).toEqual([]);
  });
});
