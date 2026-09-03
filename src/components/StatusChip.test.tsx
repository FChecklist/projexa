/// <reference types="bun-types" />
// R67 D-16 -- "a status is a GLYPH AND A WORD, never colour alone".
//
// This component is small enough to look self-evidently correct, which is
// exactly why it is worth pinning: the accessibility property it exists for is
// invisible in code review. A refactor that dropped the label and kept the
// coloured dot, or that filled the hollow circle so the two states differed
// only in hue, would look tidier and would silently undo the whole reason the
// chip is not a `<Badge>`.
//
// So the two assertions that matter are: the WORD is always present, and the
// two states differ in SHAPE (filled vs hollow) and not merely in colour.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { StatusChip } from "./StatusChip";

afterEach(cleanup);

/** The dot is the only aria-hidden span in the chip. */
function glyphOf(container: HTMLElement): HTMLElement {
  const glyph = container.querySelector("span[aria-hidden]");
  if (!glyph) throw new Error("the chip rendered no glyph");
  return glyph as HTMLElement;
}

describe("StatusChip", () => {
  test("the word is always rendered -- colour alone is not a status", () => {
    const { container } = render(<StatusChip label="published" filled tone="done" />);
    expect(container.textContent).toContain("published");
  });

  test("a filled chip differs from a hollow one in SHAPE, not only in hue", () => {
    const filled = render(<StatusChip label="published" filled tone="done" />);
    const filledGlyph = glyphOf(filled.container);
    // Terminal/committed: a solid disc.
    expect(filledGlyph.style.backgroundColor).not.toBe("");
    expect(filledGlyph.style.border).toBe("");

    cleanup();

    const hollow = render(<StatusChip label="draft" filled={false} tone="neutral" />);
    const hollowGlyph = glyphOf(hollow.container);
    // Still open: an outline. A greyscale print keeps this distinction.
    expect(hollowGlyph.style.border).not.toBe("");
    expect(hollowGlyph.style.backgroundColor).toBe("");
  });

  test("the glyph is decorative -- a screen reader hears the word, not 'circle'", () => {
    const { container } = render(<StatusChip label="draft" filled={false} />);
    expect(glyphOf(container).getAttribute("aria-hidden")).not.toBeNull();
  });

  test("each tone uses the kit's own status token, never a new colour", () => {
    // Spending the saffron primary-action colour or the rose error colour on
    // "this meeting is published" is what makes nothing on a screen read as
    // urgent, because everything does.
    const done = render(<StatusChip label="published" filled tone="done" />);
    expect(done.container.innerHTML).toContain("--color-veri-status-done");
    cleanup();

    const context = render(<StatusChip label="in review" filled={false} tone="context" />);
    expect(context.container.innerHTML).toContain("--color-veri-status-context");
    cleanup();

    // The default tone is the ordinary muted grey, not an accent.
    const neutral = render(<StatusChip label="draft" filled={false} />);
    expect(neutral.container.innerHTML).toContain("--color-ct-muted");
  });

  test("the chip never wraps mid-status", () => {
    // A two-word status breaking across lines separates the glyph from its word.
    const { container } = render(<StatusChip label="Sent back" filled={false} />);
    expect(container.querySelector("span")?.className).toContain("whitespace-nowrap");
  });
});
