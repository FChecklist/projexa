/// <reference types="bun-types" />
// "+ Connect to AI" (owner order 2026-10-11): with no AI connected the typing area is grey and says so; pressing it asks for the Connect panel.
// Menus, pills and Send for a pill-path request are untouched (traditional software must keep working). Connected: the box is exactly as before.
// Falsifiability: stop disabling the textarea, or hide Send while locked, and these fail.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Composer } from "./Composer";

afterEach(cleanup);

const base = { instruction: "Pick a module", canSend: true, value: "", onChange: () => {}, onSubmit: () => {} };

describe("Composer when no AI is connected", () => {
  test("the typing area is disabled and covered by + Connect to AI; pressing it opens the panel", () => {
    const onConnectAi = mock(() => {});
    const { getByTestId, getByLabelText } = render(<Composer {...base} aiLocked onConnectAi={onConnectAi} />);
    expect((getByLabelText("Describe the task") as HTMLTextAreaElement).disabled).toBe(true);
    const cover = getByTestId("composer-ai-locked");
    expect(cover.textContent).toContain("+ Connect to AI");
    fireEvent.click(cover);
    expect(onConnectAi).toHaveBeenCalledTimes(1);
  });

  test("Send stays available for the pill path (no typing, no AI)", () => {
    const onSubmit = mock(() => {});
    const { getByTestId } = render(<Composer {...base} onSubmit={onSubmit} aiLocked onConnectAi={() => {}} />);
    const send = getByTestId("composer-send") as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("connected: no cover, the textarea takes typing", () => {
    const { queryByTestId, getByLabelText } = render(<Composer {...base} aiLocked={false} />);
    expect(queryByTestId("composer-ai-locked")).toBeNull();
    expect((getByLabelText("Describe the task") as HTMLTextAreaElement).disabled).toBe(false);
  });
});
