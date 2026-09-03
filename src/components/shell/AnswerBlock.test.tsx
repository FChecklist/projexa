/// <reference types="bun-types" />
// R67 FIX PASS -- AnswerBlock had no test.
//
// It is what band 2 renders for a CHAT verdict, and C-05 states three rules
// about it that nothing asserted:
//
//   1. ROWS FIRST. An answer is the records, not a paragraph about them.
//   2. EXACTLY ONE LINK. A wall of destinations is how a reader stops reading;
//      the block offers the rows and one way out.
//   3. EVERY ROW LOADS A CHAIN AND STOPS. Same load-never-execute rule as the
//      Task Master row -- reading an answer must not be able to write.
//
// And M24's own rule, which this component is where it gets broken: AN EMPTY
// ANSWER IS STILL AN ANSWER. "No results" tells the reader nothing about which
// question came back empty.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AnswerBlock } from "./AnswerBlock";

afterEach(cleanup);

const ROWS = [
  { id: "r1", label: "Excavation", value: "50 %" },
  { id: "r2", label: "Backfill", value: "10 %" },
  { id: "r3", label: "Blinding", value: "0 %" },
];

describe("an answer is its rows", () => {
  test("the heading names the question and is the block's accessible name", () => {
    const { getByLabelText } = render(<AnswerBlock heading="Progress on Cedar Heights" rows={ROWS} />);
    expect(getByLabelText("Progress on Cedar Heights")).toBeTruthy();
  });

  test("every row is rendered with its label and its value, in order", () => {
    const { getAllByRole } = render(<AnswerBlock heading="Progress" rows={ROWS} onOpenRow={() => {}} />);
    const buttons = getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toContain("Excavation");
    expect(buttons[0].textContent).toContain("50 %");
    expect(buttons[2].textContent).toContain("Blinding");
  });

  test("a row with no value renders its label alone rather than an empty column", () => {
    const { getByRole } = render(
      <AnswerBlock heading="Tasks" rows={[{ id: "r1", label: "Joinery shop drawings" }]} onOpenRow={() => {}} />
    );
    expect(getByRole("button", { name: "Joinery shop drawings" })).toBeTruthy();
  });
});

describe("*** A ROW LOADS A CHAIN AND STOPS ***", () => {
  test("clicking a row reports THAT row, and nothing else happens", () => {
    const opened: string[] = [];
    const { getAllByRole } = render(
      <AnswerBlock heading="Progress" rows={ROWS} onOpenRow={(row) => opened.push(row.id)} />
    );
    fireEvent.click(getAllByRole("button")[1]);
    expect(opened).toEqual(["r2"]);
  });

  test("with no handler the rows are DISABLED, not silently inert", () => {
    const { getAllByRole } = render(<AnswerBlock heading="Progress" rows={ROWS} />);
    // A control that looks pressable and does nothing is the defect; a
    // disabled one at least tells the truth.
    for (const b of getAllByRole("button")) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe("exactly one link beyond the rows", () => {
  test("the link renders and calls its own handler", () => {
    let opened = 0;
    const { getByRole } = render(
      <AnswerBlock
        heading="Progress"
        rows={ROWS}
        onOpenRow={() => {}}
        link={{ label: "Open Work Progress", onOpen: () => { opened += 1; } }}
      />
    );
    fireEvent.click(getByRole("button", { name: "Open Work Progress" }));
    expect(opened).toBe(1);
  });

  test("there is ONE of it -- three rows plus one link is four controls, never more", () => {
    const { getAllByRole } = render(
      <AnswerBlock heading="Progress" rows={ROWS} onOpenRow={() => {}} link={{ label: "Open Work Progress", onOpen: () => {} }} />
    );
    expect(getAllByRole("button")).toHaveLength(4);
  });

  test("with no link the block is the rows alone", () => {
    const { getAllByRole } = render(<AnswerBlock heading="Progress" rows={ROWS} onOpenRow={() => {}} />);
    expect(getAllByRole("button")).toHaveLength(3);
  });
});

describe("*** AN EMPTY ANSWER IS STILL AN ANSWER ***", () => {
  test("it says which question came back empty, in the caller's own words", () => {
    const { getByText, queryAllByRole } = render(
      <AnswerBlock
        heading="Permits expiring in the next 30 days"
        rows={[]}
        emptyText="No permits expire in the next 30 days."
      />
    );
    expect(getByText("No permits expire in the next 30 days.")).toBeTruthy();
    expect(queryAllByRole("button")).toHaveLength(0);
  });

  test("with no words supplied the fallback still names the scope, never 'no results'", () => {
    const { getByText } = render(<AnswerBlock heading="Progress" rows={[]} />);
    const fallback = getByText("Nothing matched that on this project.");
    expect(fallback).toBeTruthy();
    expect(fallback.textContent).not.toBe("No results");
  });
});
