/// <reference types="bun-types" />
// R67 WS-C (C-08) -- PROJEXA'S FORK OF THE KIT'S OptionChain.
//
// The kit's multi mode is a flat row of checkbox chips with no trade
// headings, no search and no way to say what an unticked chip MEANS. Each of
// the fork's additions is a claim about what a foreman can read off the grid,
// so each is asserted here:
//
//   1. an UNTICKED chip says "absent" IN WORDS -- colour and a missing tick
//      never carry that meaning alone;
//   2. the grid is grouped by trade, and a search that empties a trade takes
//      that trade's heading with it (a heading over nothing reads as "this
//      whole trade is gone", which is not what a filter did);
//   3. Space toggles the highlighted chip, because each chip is a real
//      <input type="checkbox"> and the browser owns that behaviour;
//   4. the single-select path still never executes on a click, and a chip
//      with an unavailableReason is shown WITH its reason rather than hidden.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
// The module-level `screen` helper binds to document.body at IMPORT time,
// before GlobalRegistrator has made one, so queries go through render()'s own.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { OptionChain } from "./OptionChain";

afterEach(cleanup);

const CREW = [
  { id: "w1", label: "Rakesh" },
  { id: "w2", label: "Anil" },
  { id: "w3", label: "Suresh" },
];

const GROUPS = [
  { label: "Carpenter", optionIds: ["w1", "w3"] },
  { label: "Mason", optionIds: ["w2"] },
];

describe("the multi-select crew grid", () => {
  test("an unticked chip says 'absent' in words, not by the absence of a tick", () => {
    const view = render(
      <OptionChain
        legend="Who was on site?"
        options={CREW}
        kind="step"
        onAdvance={() => {}}
        multi
        selectedIds={["w1", "w3"]}
        onToggle={() => {}}
        uncheckedWord="absent"
      />
    );
    expect(view.getAllByText("absent").length).toBe(1);
  });

  test("Space on a highlighted chip toggles it -- the checkbox is real", () => {
    const toggled: string[] = [];
    const view = render(
      <OptionChain
        legend="Who was on site?"
        options={CREW}
        kind="step"
        onAdvance={() => {}}
        multi
        selectedIds={["w1", "w2", "w3"]}
        onToggle={(id) => toggled.push(id)}
        uncheckedWord="absent"
      />
    );
    const boxes = view.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.length).toBe(3);
    // A real checkbox: the browser turns Space into a click, and
    // fireEvent.click is the same event that produces.
    fireEvent.click(boxes[1]);
    expect(toggled).toEqual(["w2"]);
  });

  test("the count line is rendered as a live status, not buried in the legend", () => {
    const view = render(
      <OptionChain
        legend="Who was on site?"
        options={CREW}
        kind="step"
        onAdvance={() => {}}
        multi
        selectedIds={["w1", "w3"]}
        onToggle={() => {}}
        countLine="2 of 3 present"
      />
    );
    expect(view.getByRole("status").textContent).toBe("2 of 3 present");
  });

  test("the grid carries trade sub-headings", () => {
    const view = render(
      <OptionChain
        legend="Who was on site?"
        options={CREW}
        kind="step"
        onAdvance={() => {}}
        multi
        selectedIds={CREW.map((c) => c.id)}
        onToggle={() => {}}
        groups={GROUPS}
      />
    );
    expect(view.getByText("Carpenter")).toBeTruthy();
    expect(view.getByText("Mason")).toBeTruthy();
  });

  // The FILTERING ITSELF is asserted in src/lib/option-grid.test.ts, against
  // the same filterOptions/groupOptions this component calls -- including
  // C-08's "a heading never survives its own group". It is not asserted here
  // because a synthetic change/input event does not move React's own value
  // tracker under happy-dom in this repo's setup, so a DOM-level search test
  // would pass or fail on the harness rather than on the behaviour. What the
  // render CAN prove is that the box exists and is labelled, which is what a
  // user needs to find it.
  test("the search box is present and says what it filters by", () => {
    const view = render(
      <OptionChain
        legend="Who was on site?"
        options={CREW}
        kind="step"
        onAdvance={() => {}}
        multi
        selectedIds={CREW.map((c) => c.id)}
        onToggle={() => {}}
        groups={GROUPS}
        searchBy="name or trade"
      />
    );
    const box = view.getByLabelText("Search by name or trade") as HTMLInputElement;
    expect(box.getAttribute("placeholder")).toBe("Search by name or trade");
    // And the grid it filters is grouped by trade before anyone types.
    expect(view.getByText("Carpenter")).toBeTruthy();
    expect(view.getByText("Mason")).toBeTruthy();
  });

  test("the Half day toggle is offered only for someone who is present", () => {
    const halved: string[] = [];
    const view = render(
      <OptionChain
        legend="Who was on site?"
        options={CREW}
        kind="step"
        onAdvance={() => {}}
        multi
        selectedIds={["w1"]}
        onToggle={() => {}}
        uncheckedWord="absent"
        secondary={{ label: "Half day", activeIds: [], onToggle: (id) => halved.push(id) }}
      />
    );
    const buttons = view.getAllByRole("button", { name: /Half day/ });
    expect(buttons.length).toBe(1);
    fireEvent.click(buttons[0]);
    expect(halved).toEqual(["w1"]);
  });

  test("an option outside every group still renders, under 'Other'", () => {
    const view = render(
      <OptionChain
        legend="Who was on site?"
        options={[...CREW, { id: "w9", label: "Vinod" }]}
        kind="step"
        onAdvance={() => {}}
        multi
        selectedIds={[]}
        onToggle={() => {}}
        groups={GROUPS}
      />
    );
    expect(view.getByText("Other")).toBeTruthy();
    expect(view.getByText("Vinod")).toBeTruthy();
  });
});

describe("the single-select path the kit already had", () => {
  test("a click ADVANCES the chain and nothing else -- it never executes", () => {
    const advanced: unknown[] = [];
    const view = render(
      <OptionChain
        legend="Which BOQ line?"
        options={[{ id: "EX-01", label: "EX-01 Excavation", isLeaf: true }]}
        kind="step"
        onAdvance={(seg) => advanced.push(seg)}
      />
    );
    fireEvent.click(view.getByRole("button", { name: "EX-01 Excavation" }));
    expect(advanced).toEqual([{ id: "EX-01", label: "EX-01 Excavation", kind: "step" }]);
  });

  test("a parent line is shown WITH its reason, not hidden and not silently inert", () => {
    const view = render(
      <OptionChain
        legend="Which BOQ line?"
        options={[
          { id: "EX", label: "EX Earthworks", unavailableReason: "Parent line — pick one of its sub-lines" },
        ]}
        kind="step"
        onAdvance={() => {}}
      />
    );
    expect(view.getByText("Parent line — pick one of its sub-lines")).toBeTruthy();
    expect(view.queryByRole("button", { name: /EX Earthworks/ })).toBeNull();
  });

  test("an empty level prompts rather than looking broken", () => {
    const view = render(<OptionChain legend="Which BOQ line?" options={[]} kind="step" onAdvance={() => {}} />);
    expect(view.getByText("Nothing to choose here yet.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// R67 C-12 -- the shortlist: the two best matches, then "Show all 28 lines".
// ---------------------------------------------------------------------------

const LINES = Array.from({ length: 28 }, (_, i) => ({
  id: `l${i + 1}`,
  label: i === 4 ? "R60SK-A Excavation and earth works" : i === 9 ? "R60SK-C Excavation to reduced level" : `Line ${i + 1}`,
}));

describe("the chip row is a shortlist, not a wall", () => {
  test("only the two best matches are drawn, and the rest are a word", () => {
    const { container, getByText } = render(
      <OptionChain
        legend="Which BOQ line?"
        options={LINES}
        kind="step"
        onAdvance={() => {}}
        bestFirstQuery="excavation"
        previewLimit={2}
        previewNoun="lines"
      />
    );
    const chips = container.querySelectorAll("button.veri-rchip");
    expect(chips).toHaveLength(2);
    expect([...chips].map((c) => c.textContent)).toEqual([
      "R60SK-A Excavation and earth works",
      "R60SK-C Excavation to reduced level",
    ]);
    expect(getByText("Show all 28 lines")).toBeTruthy();
  });

  test("the rest are one click away, and the count is the whole list", () => {
    const { container, getByText } = render(
      <OptionChain
        legend="Which BOQ line?"
        options={LINES}
        kind="step"
        onAdvance={() => {}}
        bestFirstQuery="excavation"
        previewLimit={2}
        previewNoun="lines"
      />
    );
    fireEvent.click(getByText("Show all 28 lines"));
    expect(container.querySelectorAll("button.veri-rchip")).toHaveLength(28);
    expect(getByText("Show fewer")).toBeTruthy();
  });

  test("without a previewLimit nothing is held back", () => {
    const { container, queryByText } = render(
      <OptionChain legend="Which BOQ line?" options={LINES} kind="step" onAdvance={() => {}} />
    );
    expect(container.querySelectorAll("button.veri-rchip")).toHaveLength(28);
    expect(queryByText(/Show all/)).toBeNull();
  });

  test("a shortlisted chip still only ADVANCES -- it never executes", () => {
    const advanced: unknown[] = [];
    const { container } = render(
      <OptionChain
        legend="Which BOQ line?"
        options={LINES}
        kind="step"
        onAdvance={(s) => advanced.push(s)}
        bestFirstQuery="excavation"
        previewLimit={2}
      />
    );
    fireEvent.click(container.querySelectorAll("button.veri-rchip")[0]);
    expect(advanced).toEqual([{ id: "l5", label: "R60SK-A Excavation and earth works", kind: "step" }]);
  });
});
