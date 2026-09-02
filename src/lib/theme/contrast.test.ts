import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AA_TEXT,
  AA_UI,
  ACCEPTED_BELOW_UI_FLOOR,
  CHART_SERIES,
  PAIRINGS,
  TOKENS,
  TOKEN_CSS_VARS,
  contrast,
  contrastRatio,
  parseHex,
  relativeLuminance,
} from "./contrast";

// R67 WS-G. This file carries the acceptance assertions for BOTH G-02 and
// G-03 -- they name two paths for the same check (src/lib/contrast.test.ts and
// src/lib/theme/contrast.test.ts) for the same two ratios, so there is one
// module and one test rather than two copies that can disagree.

describe("the WCAG 2.x formula itself", () => {
  test("reproduces the two anchor ratios the standard defines", () => {
    // Black on white is the standard's own maximum, 21:1; a colour against
    // itself is its minimum, 1:1. If either of these moves, the formula is
    // wrong and every assertion below is meaningless.
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#F5820A", "#F5820A")).toBeCloseTo(1, 10);
  });

  test("is order-independent", () => {
    expect(contrastRatio(TOKENS.navy, TOKENS.saffron)).toBeCloseTo(
      contrastRatio(TOKENS.saffron, TOKENS.navy),
      10
    );
  });

  test("parses both hex forms and rejects anything else", () => {
    expect(parseHex("#F5820A")).toEqual([245, 130, 10]);
    expect(parseHex("f5820a")).toEqual([245, 130, 10]);
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(() => parseHex("saffron")).toThrow();
    expect(() => parseHex("#12345")).toThrow();
  });

  test("relative luminance spans 0..1 at the extremes", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 10);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 10);
  });
});

describe("the three failures the R66 audit measured", () => {
  // These three are the reason WS-G exists. They are asserted as the audit
  // stated them, to prove the formula here agrees with the audit's own.
  test("saffron TEXT on cream is 2.56:1 -- which is why saffron is never text", () => {
    expect(contrastRatio(TOKENS.saffron, TOKENS.cream)).toBeCloseTo(2.56, 2);
    expect(contrastRatio(TOKENS.saffron, TOKENS.cream)).toBeLessThan(AA_TEXT);
  });

  test("white on saffron is 2.60:1 -- which is why the button text became navy", () => {
    expect(contrastRatio(TOKENS.white, TOKENS.saffron)).toBeCloseTo(2.6, 2);
    expect(contrastRatio(TOKENS.white, TOKENS.saffron)).toBeLessThan(AA_TEXT);
  });

  test("the bright red that used to mark 'superseded' is not in the palette", () => {
    // R-260: rose is reserved for late and error; superseded is a grey chip.
    // A literal red would have to be added to TOKENS to be used, and this
    // asserts nothing named it.
    expect(Object.values(TOKENS)).not.toContain("#EF4444");
    expect(Object.values(TOKENS)).not.toContain("#C0392B");
  });
});

describe("G-02 / G-03 / G-05 acceptance", () => {
  test("contrast('#1C2B3A', '#F5820A') >= 4.5 -- navy on the saffron primary button", () => {
    expect(contrast("#1C2B3A", "#F5820A")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast("#1C2B3A", "#F5820A")).toBeCloseTo(5.55, 2);
  });

  test("contrast('#FFFFFF', '#A8540A') >= 4.5 -- the C-13 white-text fallback fill", () => {
    expect(contrast("#FFFFFF", "#A8540A")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast("#FFFFFF", "#A8540A")).toBeCloseTo(5.33, 2);
  });

  test("contrastRatio(tokens.primaryText, tokens.saffron) >= 4.5 -- via the tokens, not literals", () => {
    // G-02 names this form specifically: the assertion must read the tokens
    // the app actually ships, so re-valuing --primary-foreground in
    // globals.css without re-valuing TOKENS.primaryText cannot pass silently.
    expect(contrastRatio(TOKENS.primaryText, TOKENS.saffron)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test("the audit's #C4640A is gone -- correction C-13 replaced it with #A8540A", () => {
    expect(Object.values(TOKENS)).not.toContain("#C4640A");
    expect(TOKENS.saffronDeep).toBe("#A8540A");
  });
});

describe("every pairing this app renders clears its floor", () => {
  test("the pairing list is actually populated", () => {
    expect(PAIRINGS.length).toBeGreaterThan(20);
  });

  for (const pairing of PAIRINGS) {
    test(`${pairing.name} clears ${pairing.floor}:1`, () => {
      const ratio = contrastRatio(pairing.fg, pairing.bg);
      // The message carries the measured number, so a failure tells you how
      // far off you are without re-running anything by hand.
      expect({ name: pairing.name, ratio: Number(ratio.toFixed(2)), floor: pairing.floor, pass: ratio >= pairing.floor }).toEqual({
        name: pairing.name,
        ratio: Number(ratio.toFixed(2)),
        floor: pairing.floor,
        pass: true,
      });
    });
  }
});

describe("the muted CVD-checked chart set (R-227)", () => {
  test("is exactly the five R-227 names, in the mandated order", () => {
    expect(CHART_SERIES).toEqual(["#4a7fa5", "#5a9178", "#c08a4a", "#b5748a", "#718096"]);
  });

  test("every slot clears the 3:1 UI floor against the dark card", () => {
    for (const hex of CHART_SERIES) {
      expect(contrastRatio(hex, TOKENS.darkCard)).toBeGreaterThanOrEqual(AA_UI);
    }
  });

  test("the five slots are five distinct colours", () => {
    expect(new Set(CHART_SERIES).size).toBe(CHART_SERIES.length);
  });

  test("no chart slot is the brand saffron", () => {
    // R-260's colour discipline: saffron means "the primary action on this
    // screen" and nothing else. A saffron bar would make a data series look
    // clickable and would put two meanings on one colour.
    expect(CHART_SERIES).not.toContain(TOKENS.saffron);
    expect(CHART_SERIES).not.toContain(TOKENS.saffronDeep);
  });

  test("the set is muted -- every slot sits in the mid lightness band", () => {
    // This is what "muted" means numerically, and it is the property that
    // makes the five readable together on ONE surface. It is deliberately NOT
    // an adjacent-pair lightness assertion: the measured neighbour ratios are
    // 1.18 / 1.21 / 1.20 / 1.12, i.e. this palette separates by HUE, not by
    // lightness, and the value printed at every mark is what carries the
    // reading (WCAG 1.4.11). Asserting lightness separation here would be
    // asserting a property the design does not have.
    for (const hex of CHART_SERIES) {
      const l = relativeLuminance(hex);
      expect(l).toBeGreaterThan(0.1);
      expect(l).toBeLessThan(0.45);
    }
  });

  test("the one accepted shortfall is recorded, reasoned, and has not got worse", () => {
    expect(ACCEPTED_BELOW_UI_FLOOR).toHaveLength(1);
    for (const entry of ACCEPTED_BELOW_UI_FLOOR) {
      const ratio = contrastRatio(entry.fg, entry.bg);
      expect(ratio).toBeCloseTo(entry.measured, 1);
      expect(ratio).toBeGreaterThanOrEqual(entry.floor);
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
// TOKENS vs globals.css. Everything above measures the hexes in contrast.ts.
// Nothing above proves those hexes are what the app actually ships -- and the
// module's own header says the two "must be kept in step". This block is what
// keeps them in step. Without it, re-valuing --primary-foreground to #FFFFFF
// would ship a 2.60:1 button with every assertion above still green, which is
// exactly how the failure came back the first time.
// ---------------------------------------------------------------------------

const GLOBALS_CSS = join(process.cwd(), "src", "app", "globals.css");

/**
 * Pulls the custom properties out of one top-level declaration block. The file
 * has exactly one `:root {` and one `.dark {` at column 0 (the `@theme inline`
 * block above them declares only var() aliases, no hexes), so a line-based
 * scan from the selector to the closing brace at column 0 is exact -- and it
 * fails loudly rather than silently returning {} if the selector moves.
 */
function declaredVars(css: string, selector: string): Record<string, string> {
  const lines = css.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === `${selector} {`);
  if (start === -1) throw new Error(`No top-level "${selector} {" block in ${GLOBALS_CSS}`);
  const out: Record<string, string> = {};
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] === "}") return out;
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i.exec(lines[i]);
    if (m) out[m[1]] = m[2].trim();
  }
  throw new Error(`Unterminated "${selector} {" block in ${GLOBALS_CSS}`);
}

const CSS = readFileSync(GLOBALS_CSS, "utf8");
const ROOT_VARS = declaredVars(CSS, ":root");
const DARK_VARS = declaredVars(CSS, ".dark");

describe("TOKENS agrees with src/app/globals.css", () => {
  test("the stylesheet is actually being parsed", () => {
    // Guards against declaredVars() returning an empty map and every
    // assertion below passing vacuously.
    expect(Object.keys(ROOT_VARS).length).toBeGreaterThan(20);
    expect(Object.keys(DARK_VARS).length).toBeGreaterThan(15);
    expect(TOKEN_CSS_VARS.length).toBeGreaterThan(25);
  });

  test("the parser reads a value this test can name by hand", () => {
    // A second guard on the parser itself: if the regex silently stopped
    // matching, every row below would fail rather than pass, but this says
    // outright what a correct parse looks like.
    expect(ROOT_VARS["--primary"]).toBe("#F5820A");
    expect(DARK_VARS["--card"]).toBe("#182430");
  });

  for (const { token, cssVar, scope } of TOKEN_CSS_VARS) {
    test(`TOKENS.${token} === ${cssVar} in ${scope === "root" ? ":root" : ".dark"}`, () => {
      const declared = (scope === "root" ? ROOT_VARS : DARK_VARS)[cssVar];
      expect({ cssVar, declared }).toEqual({ cssVar, declared: expect.any(String) });
      // Hex comparison is case-insensitive: globals.css writes the chart set
      // lower-case and the brand colours upper-case, and both are the colour.
      expect(declared.toUpperCase()).toBe(TOKENS[token].toUpperCase());
    });
  }

  test("the primary button's own pair is read from the stylesheet, not from TOKENS", () => {
    // The one assertion that would have caught the original regression on its
    // own: it never touches TOKENS at all.
    expect(contrastRatio(ROOT_VARS["--primary-foreground"], ROOT_VARS["--primary"])).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(DARK_VARS["--primary-foreground"], DARK_VARS["--primary"])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test("no status text tone is missing from either block", () => {
    // A tone declared in :root but not in .dark inherits the light value onto
    // the dark card, where it fails AA -- a silent failure the pairing list
    // above cannot see, because it asserts the value it was handed.
    for (const name of [
      "--status-needs-you-text",
      "--status-running-text",
      "--status-done-text",
      "--status-late-text",
      "--status-neutral-text",
      "--brand-text",
    ]) {
      expect({ name, inRoot: name in ROOT_VARS, inDark: name in DARK_VARS }).toEqual({
        name,
        inRoot: true,
        inDark: true,
      });
    }
  });
});
