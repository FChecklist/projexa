/// <reference types="bun-types" />
// The page side of the browser AI: the in-page manual tag, and the one-click confirmation of an AI's delete, which a
// script (the AI included) cannot click for the person.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AiDraftConfirm, AiManualScript, onlyTrusted } from "./AiAttach";
import { buildManual } from "./manual";
import { makeRig } from "./__fixtures__/ai-rig";

afterEach(() => cleanup());

const VOID = { projectId: "p1", receiptId: "mr1", reason: "Duplicate entry" };

describe("AiManualScript", () => {
  test("renders the static manual as <script type=application/json id=px-ai-manual>", () => {
    const { container } = render(<AiManualScript />);
    const tag = container.querySelector("script#px-ai-manual");
    expect(tag?.getAttribute("type")).toBe("application/json");
    expect(JSON.parse(tag!.textContent!)).toEqual(JSON.parse(JSON.stringify(buildManual())));
  });
});

describe("AiDraftConfirm", () => {
  test("shows nothing until the AI asks for a delete, then an accessible request with two labelled buttons", async () => {
    const { surface } = await makeRig({ role: "manager" });
    const screen = render(<AiDraftConfirm surface={surface} />);
    expect(screen.queryByRole("region", { name: "Requests from your AI" })).toBeNull();
    await act(async () => { await surface.api.delete("void_material_receipt", { kind: "material_receipts", id: "mr1" }, VOID); });
    expect(screen.getByRole("region", { name: "Requests from your AI" })).toBeTruthy();
    expect(screen.getByText(/GRN-7/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm: Void a material receipt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Keep it/ })).toBeTruthy();
  });

  test("a script's click (isTrusted false) confirms nothing", async () => {
    const { surface, enqueued } = await makeRig({ role: "manager" });
    const screen = render(<AiDraftConfirm surface={surface} />);
    await act(async () => { await surface.api.delete("void_material_receipt", { kind: "material_receipts", id: "mr1" }, VOID); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm: Void a material receipt" })); });
    await act(async () => { (screen.getByRole("button", { name: "Confirm: Void a material receipt" }) as HTMLButtonElement).click(); });
    // Give a confirm that wrongly ran every chance to reach the outbox before looking.
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(enqueued()).toBe(0);
    expect(surface.drafts.list()).toHaveLength(1);
  });

  test("onlyTrusted runs the action for a real person's event only", () => {
    let ran = 0;
    expect(onlyTrusted({ isTrusted: false }, () => { ran += 1; })).toBe(false);
    expect(onlyTrusted({ isTrusted: true }, () => { ran += 1; })).toBe(true);
    expect(ran).toBe(1);
  });
});
