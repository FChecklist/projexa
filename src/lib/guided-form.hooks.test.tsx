/// <reference types="bun-types" />
// GUIDED ERRORS G3: the two hooks every G3 form is built on. useFormDraft keeps what was typed across leaving and coming back and forgets it after a
// save; useCheckedSubmit runs the form's own checks first and shows a fault in the same slot as a server refusal.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { fault, useCheckedSubmit, useFormDraft } from "./guided-form";
import type { UseSubmit } from "./use-submit";

beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

function DraftForm({ id }: { id: string }) {
  const draft = useFormDraft(id, { qty: "" });
  return (
    <div>
      {/* a controlled input cannot be typed into under happy-dom (documented in MilestonesClient.tsx), so the "typing" is a button */}
      <button data-testid="type" onClick={() => draft.onChange("qty", "77")} />
      <span data-testid="qty">{draft.values.qty}</span>
      <span data-testid="restored">{draft.restored ? "yes" : "no"}</span>
      <button data-testid="clear" onClick={() => draft.clear()} />
    </div>
  );
}

describe("useFormDraft", () => {
  test("what was typed is back after the form is closed and opened again; clear() forgets it", async () => {
    const first = render(<DraftForm id="g3-test:a" />);
    await act(async () => {
      fireEvent.click(first.getByTestId("type"));
    });
    expect(JSON.parse(sessionStorage.getItem("px-draft:g3-test:a") ?? "{}").value.qty).toBe("77");
    first.unmount();

    const second = render(<DraftForm id="g3-test:a" />);
    await act(async () => {});
    expect(second.getByTestId("qty").textContent).toBe("77");
    expect(second.getByTestId("restored").textContent).toBe("yes");

    await act(async () => {
      fireEvent.click(second.getByTestId("clear"));
    });
    expect(sessionStorage.getItem("px-draft:g3-test:a")).toBeNull();
  });

  test("two forms never share a draft", async () => {
    const a = render(<DraftForm id="g3-test:one" />);
    await act(async () => {
      fireEvent.click(a.getByTestId("type"));
    });
    a.unmount();
    const b = render(<DraftForm id="g3-test:two" />);
    await act(async () => {});
    expect(b.getByTestId("qty").textContent).toBe("");
    expect(b.getByTestId("restored").textContent).toBe("no");
  });
});

function Harness({ bad, calls }: { bad: boolean; calls: string[] }) {
  const submit = { submit: () => calls.push("sent"), failure: null, saving: false, saved: false, state: "idle", clearFailure: () => {} } as unknown as UseSubmit;
  const checked = useCheckedSubmit(submit, () => (bad ? fault("QTY_NOT_POSITIVE", "quantity", "Quantity must be above 0.") : null));
  return (
    <div>
      <button data-testid="save" onClick={checked.onSubmit} />
      <button data-testid="edit" onClick={checked.clearFault} />
      <span data-testid="failure">{checked.failure ? `${checked.failure.code}|${checked.failure.field}|${checked.failure.message}` : "none"}</span>
    </div>
  );
}

describe("useCheckedSubmit", () => {
  test("a fault stops the save, names the code and the field, and goes away when the person edits", async () => {
    const calls: string[] = [];
    const view = render(<Harness bad calls={calls} />);
    await act(async () => {
      fireEvent.click(view.getByTestId("save"));
    });
    expect(calls).toEqual([]);
    expect(view.getByTestId("failure").textContent).toBe("QTY_NOT_POSITIVE|quantity|Quantity must be above 0.");
    await act(async () => {
      fireEvent.click(view.getByTestId("edit"));
    });
    expect(view.getByTestId("failure").textContent).toBe("none");
  });

  test("no fault: the real save runs", async () => {
    const calls: string[] = [];
    const view = render(<Harness bad={false} calls={calls} />);
    await act(async () => {
      fireEvent.click(view.getByTestId("save"));
    });
    expect(calls).toEqual(["sent"]);
    expect(view.getByTestId("failure").textContent).toBe("none");
  });
});
