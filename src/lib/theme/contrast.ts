// R67 WS-G (R-197 / R-214 / R-227 / R-087 / R-260) -- the WCAG 2.x contrast
// formula, plus the exact hex values this app's own globals.css commits to,
// so a colour pairing can be ASSERTED in a unit test instead of eyeballed.
//
// WHY THIS FILE EXISTS. The audit measured three real failures on the live
// product: saffron text on cream is 2.56:1, white text on the saffron primary
// button is 2.60:1, and the "days left" permit chip carried its meaning in
// colour alone. Two of those are pure token choices, so the fix is a token
// choice -- and a token choice that is not tested drifts back. Every pairing
// this app relies on is listed in PAIRINGS below and asserted in
// contrast.test.ts; adding a colour to globals.css without adding it here is
// how the 2.60:1 button came back the first time.
//
// D-09: these values are PROJEXA's own. @fchecklist/veridian-ui-kit's token
// file is not edited and no kit release is cut -- src/app/globals.css
// re-declares the ones that needed changing, after importing the kit's, and
// this module is the machine-readable copy of that override block. The two are
// kept in step MECHANICALLY: TOKEN_CSS_VARS below maps each token to the
// custom property it copies, and contrast.test.ts parses globals.css and
// asserts every row. Editing one file without the other fails the suite.

/** One channel of an sRGB colour, linearised per WCAG 2.x. */
function channelLuminance(srgb8Bit: number): number {
  const c = srgb8Bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** `#RGB` or `#RRGGBB` (case-insensitive) -> [r, g, b] in 0..255. */
export function parseHex(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/**
 * WCAG 2.x contrast ratio between two opaque colours, 1 .. 21.
 * Order-independent: contrastRatio(a, b) === contrastRatio(b, a).
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** Shorthand used by the design spec's own section 8 wording. */
export const contrast = contrastRatio;

/** WCAG AA floor for normal-size text and for meaning-bearing glyphs. */
export const AA_TEXT = 4.5;
/** WCAG AA floor for non-text UI (borders, chart marks, control outlines). */
export const AA_UI = 3;

/**
 * Every token this app pairs deliberately. Names match the CSS custom
 * property in src/app/globals.css one-for-one (minus the `--` prefix), so a
 * reader can go from a failing assertion straight to the line that owns it.
 */
export const TOKENS = {
  // Surfaces.
  /** --background (light) */ cream: "#FFFDF9",
  /** --popover (light): the white surface a dropdown/dialog paints on. */ white: "#FFFFFF",
  /** --secondary / --muted fill */ cloud: "#F0F4F8",
  /** .dark --background */ darkSurface: "#10181F",
  /** .dark --card */ darkCard: "#182430",

  // Brand.
  /** --primary: the saffron fill. NEVER used as text. */ saffron: "#F5820A",
  /**
   * --primary-foreground: navy ON saffron. This is the R-197/R-260 fix --
   * the button keeps the saffron fill and the text becomes navy, so no new
   * colour enters the palette.
   */
  primaryText: "#1C2B3A",
  /** --foreground: ink for body copy and every KPI figure. */ navy: "#1C2B3A",
  /**
   * The C-13 fallback fill, for the rare place white text on an orange fill
   * is unavoidable. Correction C-13 replaced the audit's #C4640A with this.
   */
  saffronDeep: "#A8540A",
  /** --brand-text: saffron's readable text-weight sibling, for links/labels. */ brandText: "#9A4D0A",

  // Status TINTS (fills and glyph strokes on a tinted chip) -- the kit's
  // four M24 tones, unchanged, imported not forked.
  /** --color-veri-status-context (dusty blue) */ statusRunningTint: "#4a7fa5",
  /** --color-veri-status-needs-you (clay) */ statusNeedsYouTint: "#c08a4a",
  /** --color-veri-status-done (sage) */ statusDoneTint: "#5a9178",
  /** --color-veri-status-late (rose) -- reserved for late and error ONLY. */ statusLateTint: "#b5748a",

  // Status TEXT tones -- the same four hues darkened until the WORD clears
  // AA on cream and on white. The tints above stay fills; these are what a
  // chip's glyph+word is actually painted in.
  /** --status-needs-you-text */ statusNeedsYouText: "#8A5A24",
  /** --status-running-text */ statusRunningText: "#2F5F82",
  /** --status-done-text */ statusDoneText: "#3E6E58",
  /** --status-late-text */ statusLateText: "#8F4F66",
  /**
   * --status-neutral-text: the grey chip's word (superseded, draft,
   * inactive). NOT --muted-foreground: #718096 measures 3.95:1 on cream and
   * would fail AA for a word that carries meaning. R-227's own instruction --
   * "meaning-bearing muted hints move to slate #4A5568" -- is what this is.
   */
  statusNeutralText: "#4A5568",
  /** --color-ct-slate: meaning-bearing muted hints move here, off #718096. */ slateText: "#4A5568",
  /**
   * --muted-foreground, unchanged at #718096 (3.95:1 on cream). Kept as-is:
   * it is a decorative secondary-text token used on essentially every screen
   * in the app, and re-valuing it is outside WS-G's brief. Nothing that
   * CARRIES MEANING is allowed to use it -- that is what statusNeutralText
   * and slateText above exist for -- so it is deliberately absent from
   * PAIRINGS rather than asserted at a floor it does not clear.
   */
  mutedHint: "#718096",

  // Dark-mode status text tones -- the same four hues lightened until the
  // word clears AA against .dark's card surface.
  /** .dark --status-needs-you-text */ statusNeedsYouTextDark: "#E0B078",
  /** .dark --status-running-text */ statusRunningTextDark: "#8FC0E4",
  /** .dark --status-done-text */ statusDoneTextDark: "#8FCBAF",
  /** .dark --status-late-text */ statusLateTextDark: "#E5A3BA",
  /** .dark --muted-foreground */ neutralTextDark: "#9AA9B5",
  /** .dark --status-neutral-text */ statusNeutralTextDark: "#9AA9B5",
  /** .dark --brand-text */ brandTextDark: "#F0A65A",
  /** .dark --primary-foreground: ink on the saffron fill in dark mode too. */ primaryTextDark: "#10181F",

  // Charts: the muted, CVD-checked five. Same values light and dark, per the
  // recommendation -- they are chosen to clear the UI floor on both surfaces.
  /** --chart-1 dusty blue */ chart1: "#4a7fa5",
  /** --chart-2 sage */ chart2: "#5a9178",
  /** --chart-3 clay */ chart3: "#c08a4a",
  /** --chart-4 rose */ chart4: "#b5748a",
  /** --chart-5 grey */ chart5: "#718096",
} as const;

export type TokenName = keyof typeof TOKENS;

/** Which declaration block of src/app/globals.css a value is declared in. */
export type TokenScope = "root" | "dark";

/**
 * THE BRIDGE BETWEEN THIS FILE AND src/app/globals.css.
 *
 * Every value in TOKENS above is a hand-copy of a custom property declared in
 * globals.css, and until this list existed nothing checked that the copy was
 * still true. That is precisely the drift this module says it exists to stop:
 * re-valuing --primary-foreground back to #FFFFFF in globals.css would ship a
 * 2.60:1 button with all thirty-odd contrast assertions still green, because
 * they would all be measuring TOKENS.primaryText, which nobody had touched.
 *
 * contrast.test.ts reads globals.css, parses the `:root` and `.dark` blocks,
 * and asserts each row below matches. A token that this app does NOT declare
 * itself -- the kit's four status TINTS, which are imported from
 * @fchecklist/veridian-ui-kit/tokens/globals.css and not overridden here -- is
 * deliberately absent rather than pointed at a property projexa does not own.
 */
export const TOKEN_CSS_VARS: { token: TokenName; cssVar: string; scope: TokenScope }[] = [
  // Surfaces.
  { token: "cream", cssVar: "--background", scope: "root" },
  { token: "white", cssVar: "--popover", scope: "root" },
  { token: "cloud", cssVar: "--secondary", scope: "root" },
  { token: "cloud", cssVar: "--muted", scope: "root" },
  { token: "darkSurface", cssVar: "--background", scope: "dark" },
  { token: "darkCard", cssVar: "--card", scope: "dark" },

  // Brand. The first row is the whole R-197/R-260 button fix.
  { token: "saffron", cssVar: "--primary", scope: "root" },
  { token: "primaryText", cssVar: "--primary-foreground", scope: "root" },
  { token: "primaryTextDark", cssVar: "--primary-foreground", scope: "dark" },
  { token: "navy", cssVar: "--foreground", scope: "root" },
  { token: "saffronDeep", cssVar: "--brand-fill-deep", scope: "root" },
  { token: "brandText", cssVar: "--brand-text", scope: "root" },
  { token: "brandTextDark", cssVar: "--brand-text", scope: "dark" },

  // Status text tones, light.
  { token: "statusNeedsYouText", cssVar: "--status-needs-you-text", scope: "root" },
  { token: "statusRunningText", cssVar: "--status-running-text", scope: "root" },
  { token: "statusDoneText", cssVar: "--status-done-text", scope: "root" },
  { token: "statusLateText", cssVar: "--status-late-text", scope: "root" },
  { token: "statusNeutralText", cssVar: "--status-neutral-text", scope: "root" },
  { token: "mutedHint", cssVar: "--muted-foreground", scope: "root" },

  // Status text tones, dark.
  { token: "statusNeedsYouTextDark", cssVar: "--status-needs-you-text", scope: "dark" },
  { token: "statusRunningTextDark", cssVar: "--status-running-text", scope: "dark" },
  { token: "statusDoneTextDark", cssVar: "--status-done-text", scope: "dark" },
  { token: "statusLateTextDark", cssVar: "--status-late-text", scope: "dark" },
  { token: "statusNeutralTextDark", cssVar: "--status-neutral-text", scope: "dark" },
  { token: "neutralTextDark", cssVar: "--muted-foreground", scope: "dark" },

  // Charts -- the same five values in both blocks, which is itself the claim.
  { token: "chart1", cssVar: "--chart-1", scope: "root" },
  { token: "chart2", cssVar: "--chart-2", scope: "root" },
  { token: "chart3", cssVar: "--chart-3", scope: "root" },
  { token: "chart4", cssVar: "--chart-4", scope: "root" },
  { token: "chart5", cssVar: "--chart-5", scope: "root" },
  { token: "chart1", cssVar: "--chart-1", scope: "dark" },
  { token: "chart2", cssVar: "--chart-2", scope: "dark" },
  { token: "chart3", cssVar: "--chart-3", scope: "dark" },
  { token: "chart4", cssVar: "--chart-4", scope: "dark" },
  { token: "chart5", cssVar: "--chart-5", scope: "dark" },
];

/**
 * The pairings this app actually renders, each with the floor it must clear.
 * contrast.test.ts walks this list, so a new pairing added here is a new
 * assertion -- that is the point.
 */
export const PAIRINGS: { name: string; fg: string; bg: string; floor: number }[] = [
  // The two the audit measured as failing.
  { name: "primary button text on saffron fill", fg: TOKENS.primaryText, bg: TOKENS.saffron, floor: AA_TEXT },
  { name: "white text on the C-13 deep-orange fill", fg: TOKENS.white, bg: TOKENS.saffronDeep, floor: AA_TEXT },
  { name: "primary button text on saffron fill (dark)", fg: TOKENS.primaryTextDark, bg: TOKENS.saffron, floor: AA_TEXT },

  // Body and KPI ink.
  { name: "navy body text on cream", fg: TOKENS.navy, bg: TOKENS.cream, floor: AA_TEXT },
  { name: "navy body text on cloud", fg: TOKENS.navy, bg: TOKENS.cloud, floor: AA_TEXT },
  { name: "brand text on cream", fg: TOKENS.brandText, bg: TOKENS.cream, floor: AA_TEXT },
  { name: "slate hint text on cream", fg: TOKENS.slateText, bg: TOKENS.cream, floor: AA_TEXT },

  // Status chips, light: glyph + word on the two real surfaces.
  { name: "needs-you chip word on cream", fg: TOKENS.statusNeedsYouText, bg: TOKENS.cream, floor: AA_TEXT },
  { name: "needs-you chip word on white", fg: TOKENS.statusNeedsYouText, bg: TOKENS.white, floor: AA_TEXT },
  { name: "running chip word on cream", fg: TOKENS.statusRunningText, bg: TOKENS.cream, floor: AA_TEXT },
  { name: "running chip word on white", fg: TOKENS.statusRunningText, bg: TOKENS.white, floor: AA_TEXT },
  { name: "done chip word on cream", fg: TOKENS.statusDoneText, bg: TOKENS.cream, floor: AA_TEXT },
  { name: "done chip word on white", fg: TOKENS.statusDoneText, bg: TOKENS.white, floor: AA_TEXT },
  { name: "late chip word on cream", fg: TOKENS.statusLateText, bg: TOKENS.cream, floor: AA_TEXT },
  { name: "late chip word on white", fg: TOKENS.statusLateText, bg: TOKENS.white, floor: AA_TEXT },
  { name: "neutral chip word on cream", fg: TOKENS.statusNeutralText, bg: TOKENS.cream, floor: AA_TEXT },
  { name: "neutral chip word on white", fg: TOKENS.statusNeutralText, bg: TOKENS.white, floor: AA_TEXT },

  // Status chips, dark: same four words against the dark card.
  { name: "needs-you chip word on dark card", fg: TOKENS.statusNeedsYouTextDark, bg: TOKENS.darkCard, floor: AA_TEXT },
  { name: "running chip word on dark card", fg: TOKENS.statusRunningTextDark, bg: TOKENS.darkCard, floor: AA_TEXT },
  { name: "done chip word on dark card", fg: TOKENS.statusDoneTextDark, bg: TOKENS.darkCard, floor: AA_TEXT },
  { name: "late chip word on dark card", fg: TOKENS.statusLateTextDark, bg: TOKENS.darkCard, floor: AA_TEXT },
  { name: "neutral chip word on dark card", fg: TOKENS.statusNeutralTextDark, bg: TOKENS.darkCard, floor: AA_TEXT },
  { name: "brand text on dark surface", fg: TOKENS.brandTextDark, bg: TOKENS.darkSurface, floor: AA_TEXT },
  { name: "brand text on dark card", fg: TOKENS.brandTextDark, bg: TOKENS.darkCard, floor: AA_TEXT },

  // Chart marks are non-text UI, so the 3:1 floor applies -- on BOTH surfaces,
  // because --chart-1..5 are deliberately the same five values in light and
  // dark (a chart legend swatch must be findable either way).
  { name: "chart-1 on cream", fg: TOKENS.chart1, bg: TOKENS.cream, floor: AA_UI },
  { name: "chart-2 on cream", fg: TOKENS.chart2, bg: TOKENS.cream, floor: AA_UI },
  { name: "chart-4 on cream", fg: TOKENS.chart4, bg: TOKENS.cream, floor: AA_UI },
  { name: "chart-5 on cream", fg: TOKENS.chart5, bg: TOKENS.cream, floor: AA_UI },
  { name: "chart-1 on dark card", fg: TOKENS.chart1, bg: TOKENS.darkCard, floor: AA_UI },
  { name: "chart-2 on dark card", fg: TOKENS.chart2, bg: TOKENS.darkCard, floor: AA_UI },
  { name: "chart-3 on dark card", fg: TOKENS.chart3, bg: TOKENS.darkCard, floor: AA_UI },
  { name: "chart-4 on dark card", fg: TOKENS.chart4, bg: TOKENS.darkCard, floor: AA_UI },
  { name: "chart-5 on dark card", fg: TOKENS.chart5, bg: TOKENS.darkCard, floor: AA_UI },
];

/**
 * The five categorical chart slots, in the fixed order R-227 mandates.
 * The order IS the CVD-safety mechanism -- do not reorder.
 */
export const CHART_SERIES = [TOKENS.chart1, TOKENS.chart2, TOKENS.chart3, TOKENS.chart4, TOKENS.chart5] as const;

/**
 * One measured, deliberately-accepted shortfall, recorded rather than hidden.
 *
 * clay #c08a4a is the hex R-227 names for --chart-3, and against cream it
 * measures 2.96:1 -- 0.04 under the 3:1 non-text floor. It is kept because
 * WCAG 1.4.11 exempts a graphical object whose information is ALSO available
 * in text, and the same recommendation requires exactly that: bar radius 0
 * with the value printed at the bar end, and a legend that carries the
 * category's word. No chart in this app conveys a value by mark colour alone.
 *
 * `floor` here is a regression guard, not an approval: if a future re-value
 * pushes clay further down, the test fails.
 */
export const ACCEPTED_BELOW_UI_FLOOR: { name: string; fg: string; bg: string; measured: number; floor: number; reason: string }[] = [
  {
    name: "chart-3 (clay) on cream",
    fg: TOKENS.chart3,
    bg: TOKENS.cream,
    measured: 2.96,
    floor: 2.9,
    reason:
      "WCAG 1.4.11 exemption: every bar prints its value at the bar end and every slice is labelled, so no meaning rests on this mark's colour.",
  },
];
