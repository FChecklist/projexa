/// <reference types="bun-types" />
// R67 D-67 -- the confirm step, and the property that matters most about it:
// arming it must not destroy anything.
//
// The defect it closes is in the kit, which renders the Delete button itself
// and calls `onDelete()` straight from onClick. Four object pages passed it
// a function that disposed a record and its file, so a single click was the
// whole interaction. These tests pin the replacement: the first click only
// arms, the sentence names what is about to go, and the destructive call
// happens on the second click and nowhere else.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/drawings/d-1",
}));

const { useDeleteConfirmation } = await import("./DeleteConfirmation");

afterEach(cleanup);

/** A minimal host that does what the object pages do: pass `request` to a
 *  Delete button and render `card` in its own children. */
function Host({ run }: { run: () => void | Promise<void> }) {
  const removal = useDeleteConfirmation({
    objectLabel: "Drawing",
    identifier: "GF-101 Ground floor plan",
    extra: "and its uploaded file",
    verb: "Remove",
    run,
  });
  return (
    <div>
      <button type="button" onClick={removal.request}>
        Delete
      </button>
      {removal.card}
    </div>
  );
}

/**
 * The confirming click starts an async run whose `finally` sets state after
 * the click handler has returned, so the act() scope has to stay open across
 * the microtask -- otherwise React warns about an update outside act(), and
 * a warning in a green suite is how a real one gets ignored.
 */
async function click(el: Element | null | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

function byText(container: HTMLElement, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as
    | HTMLElement
    | undefined;
}

describe("useDeleteConfirmation", () => {
  test("nothing is armed until the destructive control is pressed", () => {
    let ran = 0;
    const { container } = render(<Host run={() => { ran += 1; }} />);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(ran).toBe(0);
  });

  test("the first click ARMS and destroys nothing -- this is the whole point", async () => {
    let ran = 0;
    const { container } = render(<Host run={() => { ran += 1; }} />);

    await click(byText(container, "Delete"));

    expect(ran).toBe(0);
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  test("the sentence names the record and what goes with it, and says it is final", async () => {
    const { container } = render(<Host run={() => {}} />);
    await click(byText(container, "Delete"));

    expect(container.textContent).toContain(
      "Delete drawing GF-101 Ground floor plan and its uploaded file? This cannot be undone."
    );
  });

  test("the second click runs it, once", async () => {
    let ran = 0;
    const { container } = render(<Host run={() => { ran += 1; }} />);
    await click(byText(container, "Delete"));
    await click(byText(container, "Remove drawing"));

    expect(ran).toBe(1);
  });

  test("Cancel closes the card and runs nothing", async () => {
    let ran = 0;
    const { container } = render(<Host run={() => { ran += 1; }} />);
    await click(byText(container, "Delete"));
    await click(byText(container, "Cancel"));

    expect(ran).toBe(0);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test("the confirming button carries the verb that describes what actually happens", async () => {
    // "Delete material" would be a lie on the Materials page, where the
    // action deactivates. The verb is the caller's to set.
    const { container } = render(<Host run={() => {}} />);
    await click(byText(container, "Delete"));
    expect(byText(container, "Remove drawing")).toBeDefined();
  });
});
