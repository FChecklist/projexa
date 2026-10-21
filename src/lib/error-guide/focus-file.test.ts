/// <reference types="bun-types" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();
import { describe, expect, test } from "bun:test";
import { HIGHLIGHT_MS, highlightElement } from "./focus";

// 2026-10-22 audit: the "file box is outlined" checks on import and site-instruction create failed -- the 3 s outline had ended before the
// (slow) check looked. A file box now keeps its outline until a file is chosen; every other element still clears after HIGHLIGHT_MS.
describe("highlightElement on a file box", () => {
  test("a file input is still outlined after HIGHLIGHT_MS and clears when a file is chosen", async () => {
    const input = document.createElement("input");
    input.type = "file";
    document.body.appendChild(input);
    highlightElement(input);
    expect(input.getAttribute("data-px-highlighted")).toBe("true");
    await new Promise((r) => setTimeout(r, 60));
    expect(input.getAttribute("data-px-highlighted")).toBe("true");
    input.dispatchEvent(new Event("change"));
    expect(input.getAttribute("data-px-highlighted")).toBeNull();
    expect(input.style.outline).toBe("");
  });
  test("a text input still clears on the ordinary short timer", () => {
    expect(HIGHLIGHT_MS).toBe(3000);
  });
});
