/// <reference types="bun-types" />
// R67 FIX PASS -- ConfirmCard is THE ONLY CONTROL IN THE WHOLE CHAIN WALK THAT
// WRITES, and it had no test.
//
// Every chip click in band 2 loads a level and stops; this card's primary is
// the single place a real POST is authorised. That makes exactly one property
// worth pinning above all others, and it is the one a reader of the component
// cannot verify by eye once the file grows: NOTHING ELSE ON THE CARD CALLS
// onPrimary. "Change value" and "Change line" walk back a step, "Start over"
// resets -- none of them may write, and a card that accidentally wired one of
// them to the primary would silently record whatever was on screen.
//
// The second property is the no-fail-after-click rule this programme states
// everywhere: when the card cannot be saved the button is DISABLED and the
// reason is in its own label, not in a tooltip and not discovered after a
// click.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard as every other happy-dom suite in this repo.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ConfirmCard } from "./ConfirmCard";

afterEach(cleanup);

type Calls = { primary: number; secondary: number; tertiary: number };

function renderCard(overrides: Partial<Parameters<typeof ConfirmCard>[0]> = {}) {
  const calls: Calls = { primary: 0, secondary: 0, tertiary: 0 };
  const view = render(
    <ConfirmCard
      title="Record Work Progress > New entry — R66-1009b Excavation · 50 %"
      fields={[
        { id: "line", label: "BOQ line", control: <span>R66-1009b Excavation</span> },
        { id: "value", label: "Percent complete", control: <span>50 %</span>, note: "read from what you typed" },
      ]}
      primaryLabel="Save"
      onPrimary={() => {
        calls.primary += 1;
      }}
      secondaryLabel="Change line"
      onSecondary={() => {
        calls.secondary += 1;
      }}
      tertiaryLabel="Start over"
      onTertiary={() => {
        calls.tertiary += 1;
      }}
      {...overrides}
    />
  );
  return { calls, ...view };
}

describe("ConfirmCard shows what will be written, in words", () => {
  test("the title is the card's own accessible name, and every field carries its label", () => {
    const { getByLabelText, getByText } = renderCard();
    // The heading is the sentence, so a screen reader lands on what is about
    // to be recorded rather than on a generic "dialog".
    expect(getByLabelText("Record Work Progress > New entry — R66-1009b Excavation · 50 %")).toBeTruthy();
    expect(getByText("BOQ line")).toBeTruthy();
    expect(getByText("Percent complete")).toBeTruthy();
    // A word beside every value -- never a camelCase parameter name.
    expect(getByText("R66-1009b Excavation")).toBeTruthy();
    expect(getByText("50 %")).toBeTruthy();
  });

  test("a field's note is rendered, so 'matched from what you typed' is visible not implied", () => {
    const { getByText } = renderCard();
    expect(getByText("read from what you typed")).toBeTruthy();
  });
});

describe("*** SAVE IS THE ONLY CONTROL THAT WRITES ***", () => {
  test("pressing Save calls onPrimary exactly once", () => {
    const { calls, getByRole } = renderCard();
    fireEvent.click(getByRole("button", { name: "Save" }));
    expect(calls.primary).toBe(1);
  });

  test("Change line and Start over walk back -- NEITHER of them writes", () => {
    const { calls, getByRole } = renderCard();
    fireEvent.click(getByRole("button", { name: "Change line" }));
    fireEvent.click(getByRole("button", { name: "Start over" }));
    expect(calls.secondary).toBe(1);
    expect(calls.tertiary).toBe(1);
    // THE ASSERTION THIS FILE EXISTS FOR.
    expect(calls.primary).toBe(0);
  });

  test("the way-out controls are absent rather than inert when no handler is given", () => {
    const { queryByRole } = renderCard({ secondaryLabel: undefined, onSecondary: undefined, tertiaryLabel: undefined, onTertiary: undefined });
    expect(queryByRole("button", { name: "Change line" })).toBeNull();
    expect(queryByRole("button", { name: "Start over" })).toBeNull();
  });
});

describe("no fail-after-click: the reason is in the label, not behind one", () => {
  test("a card short of an answer disables Save AND says what is missing", () => {
    const { calls, getByRole } = renderCard({
      primaryLabel: "Save (pick a task)",
      primaryDisabledReason: "Pick a task",
    });
    const button = getByRole("button", { name: "Save (pick a task)" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(calls.primary).toBe(0);
  });

  test("a busy card says 'Saving…', cannot be pressed twice, and locks its ways out too", () => {
    const { calls, getByRole } = renderCard({ busy: true });
    // The label changes rather than the button merely greying: a Send is never
    // met with silence, which is the same rule C-05 states for band 2.
    const button = getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(calls.primary).toBe(0);
    // And the ways out are locked while a write is in flight, so "Start over"
    // cannot race the request that is already recording something.
    expect((getByRole("button", { name: "Change line" }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole("button", { name: "Start over" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a refusal from a previous attempt is shown, and the card stays on screen to be corrected", () => {
    const { getByText, getByRole } = renderCard({ error: "There is no line 3.04 on Cedar Heights — pick a line" });
    expect(getByText("There is no line 3.04 on Cedar Heights — pick a line")).toBeTruthy();
    // C-09: a refusal KEEPS the card, with the control that fixes it.
    expect(getByRole("button", { name: "Change line" })).toBeTruthy();
  });
});
