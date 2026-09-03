/// <reference types="bun-types" />
// R67 FIX PASS -- ChainOptionsPanel had no test.
//
// OptionChain (the chip grid it wraps) is covered; this file is the STATE
// MACHINE around it, and every one of its four states exists because the
// alternative was a real defect the R66 walkthrough captured:
//
//   ERROR   -- and error wins over a STALE LEVEL. A list of chips left on
//              screen under a failed refetch is a set of options that may no
//              longer exist, and each one is one click from a write.
//   LOADING -- the legend arrives BEFORE its answers, so the question is on
//              screen while the options are still coming.
//   EMPTY   -- "nothing to choose" is a precondition the user can go and
//              satisfy, so it states the fact AND offers the way out.
//   OPTIONS -- the chips.
//
// The ordering is the part a reader of the file cannot verify by eye once it
// grows, and it is the part that matters most.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChainOptionsPanel } from "./ChainOptionsPanel";
import type { ChainOptionsLevel } from "@/lib/card-catalogue";

afterEach(cleanup);

const LEVEL: ChainOptionsLevel = {
  legend: "Which BOQ line?",
  kind: "step",
  options: [
    { id: "R60SK-A", label: "R60SK-A Excavation" },
    { id: "R60SK-B", label: "R60SK-B Backfill" },
  ],
};

const EMPTY_LEVEL: ChainOptionsLevel = {
  legend: "Which BOQ line?",
  kind: "step",
  options: [],
  emptyPrompt: { text: "This project has no BOQ yet.", actionLabel: "New BOQ", route: "/scope/new" },
};

describe("the options state -- the chips", () => {
  test("the legend is the question, and every option is a chip", () => {
    const { getAllByText, getByText } = render(<ChainOptionsPanel level={LEVEL} onAdvance={() => {}} />);
    // The legend appears twice by design -- once visibly and once as the
    // fieldset's own accessible name -- so this asserts it is present without
    // pretending it is unique.
    expect(getAllByText("Which BOQ line?").length).toBeGreaterThanOrEqual(1);
    expect(getByText("R60SK-A Excavation")).toBeTruthy();
    expect(getByText("R60SK-B Backfill")).toBeTruthy();
  });

  test("picking a chip advances the chain -- and that is the only thing it does", () => {
    const advanced: string[] = [];
    const { getByText } = render(
      <ChainOptionsPanel level={LEVEL} onAdvance={(seg) => advanced.push(seg.id)} />
    );
    fireEvent.click(getByText("R60SK-A Excavation"));
    expect(advanced).toEqual(["R60SK-A"]);
  });
});

describe("*** ERROR WINS OVER A STALE LEVEL ***", () => {
  test("with both an error and a level in hand, the error is what renders", () => {
    const { getByRole, queryByText } = render(
      <ChainOptionsPanel level={LEVEL} error="The construction data service didn't answer" onAdvance={() => {}} />
    );
    expect(getByRole("alert").textContent).toBe("The construction data service didn't answer");
    // THE ASSERTION THIS BLOCK EXISTS FOR: no chip survives a failed read.
    // Each one is one click from a write against an option that may be gone.
    expect(queryByText("R60SK-A Excavation")).toBeNull();
  });

  test("the error is the BACKEND'S own words, and it comes with a Retry when one is possible", () => {
    let retried = 0;
    const { getByRole } = render(
      <ChainOptionsPanel level={null} error="Couldn't load this project's BOQ" onRetry={() => { retried += 1; }} onAdvance={() => {}} />
    );
    fireEvent.click(getByRole("button", { name: "Retry" }));
    expect(retried).toBe(1);
  });

  test("with no retry handler there is no Retry button -- a dead control is worse than none", () => {
    const { queryByRole } = render(
      <ChainOptionsPanel level={null} error="Couldn't load this project's BOQ" onAdvance={() => {}} />
    );
    expect(queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("the loading state -- the question arrives before its answers", () => {
  test("the legend is shown while the options are still coming", () => {
    const { getByText, queryByText } = render(
      <ChainOptionsPanel level={null} loading loadingLegend="Which BOQ line?" onAdvance={() => {}} />
    );
    expect(getByText("Which BOQ line?")).toBeTruthy();
    expect(queryByText("R60SK-A Excavation")).toBeNull();
  });

  test("it announces itself to a screen reader rather than only drawing skeletons", () => {
    const { getByRole } = render(
      <ChainOptionsPanel level={null} loading loadingLegend="Which BOQ line?" onAdvance={() => {}} />
    );
    expect(getByRole("status").textContent).toContain("Which BOQ line?");
  });

  test("a null level with no error and no loading flag still renders the loading shape, never nothing", () => {
    const { getByRole } = render(<ChainOptionsPanel level={null} onAdvance={() => {}} />);
    // A band that renders nothing at all is indistinguishable from a broken
    // one; this at least says a question is on its way.
    expect(getByRole("status")).toBeTruthy();
  });
});

describe("*** AN EMPTY LEVEL PROMPTS, IT DOES NOT LOOK BROKEN ***", () => {
  test("it states the fact and offers the way out in the same breath", () => {
    const routes: string[] = [];
    const { getByText, getByRole } = render(
      <ChainOptionsPanel level={EMPTY_LEVEL} onAdvance={() => {}} onEmptyAction={(r) => routes.push(r)} />
    );
    expect(getByText("This project has no BOQ yet.")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "New BOQ" }));
    expect(routes).toEqual(["/scope/new"]);
  });

  test("an empty level with no prompt still says something rather than rendering blank", () => {
    const { getByText } = render(
      <ChainOptionsPanel level={{ legend: "Which BOQ line?", kind: "step", options: [] }} onAdvance={() => {}} />
    );
    expect(getByText("Nothing to choose here yet.")).toBeTruthy();
  });
});
