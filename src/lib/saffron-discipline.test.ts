import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// R67 WS-G (R-197 / R-260) -- the regression guard for the colour rule that
// is easiest to break by accident, because breaking it looks like using the
// brand.
//
// THE RULE, in two parts:
//   1. SAFFRON IS NEVER TEXT ON AN APP SURFACE. #F5820A on the app's cream
//      (#FFFDF9) is 2.56:1. It is a FILL colour. A saffron WORD -- a link, a
//      badge, an icon carrying meaning, a "Retry" -- is unreadable to a
//      large number of real users and fails WCAG AA outright. Where a
//      brand-coloured word is genuinely wanted the token is --brand-text
//      (#9A4D0A, 6.01:1), exposed as the `text-brand-text` utility.
//   2. WHITE IS NEVER ON A SAFFRON FILL. #FFFFFF on #F5820A is 2.60:1, which
//      is what made every primary button in this app fail. The default fix
//      is navy on the unchanged saffron fill (5.55:1), which is now what
//      --primary-foreground is, so no button needs its own class. Where white
//      text is genuinely unavoidable, correction C-13's darker fill
//      --brand-fill-deep (#A8540A, white at 5.33:1) is the fallback, exposed
//      as `bg-brand-fill-deep`.
//
// This is a source scan rather than an eslint rule alone because the same
// class can arrive as a bare string, inside a template literal, or through
// cn() -- eslint's no-restricted-syntax (see eslint.config.mjs, which carries
// the literal-string half of this rule so the violation is also flagged in
// the editor) matches the first shape only. Between them, both shapes are
// covered.
//
// SCOPE. Everything under src/, with ONE documented exemption below.
const SRC = join(process.cwd(), "src");

/**
 * src/components/marketing/** is the public landing page, and it is a
 * DIFFERENT GROUND: its hero and header sit on the navy #1C2B3A / #10181F
 * surfaces, where saffron text measures 5.55:1 and 6.89:1 -- it passes AA
 * there, and the app's 2.56:1 figure simply does not apply. The white-on-
 * saffron half of the rule is NOT exempt anywhere, including here (those call
 * sites were moved to --brand-fill-deep), and the assertion below proves the
 * exemption is narrow: it covers `text-*` only.
 */
const TEXT_RULE_EXEMPT_DIR = join("src", "components", "marketing");

/** Saffron used as a TEXT colour. */
const SAFFRON_AS_TEXT = /\btext-(?:px-orange|ct-saffron)\b|text-\[(?:color:)?var\(--color-ct-saffron\)\]/;

/** A saffron FILL and white text on the same element. */
const WHITE_ON_SAFFRON = /\bbg-(?:px-orange|ct-saffron)(?:\/\d+)?\b(?=[^"'`]*\btext-white\b)|\btext-white\b(?=[^"'`]*\bbg-(?:px-orange|ct-saffron)(?:\/\d+)?\b)/;

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// A class name written inside a comment renders nothing, so strip comments
// first -- otherwise this file's own prose, and the explanatory comments in
// globals.css-adjacent components, would trip the guard.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function offenders(pattern: RegExp, skipDir?: string): string[] {
  const found: string[] = [];
  for (const file of sourceFilesUnder(SRC)) {
    const rel = relative(process.cwd(), file);
    if (skipDir && rel.startsWith(skipDir + sep)) continue;
    const body = withoutComments(readFileSync(file, "utf8"));
    for (const [i, line] of body.split("\n").entries()) {
      if (pattern.test(line)) found.push(`${rel}:${i + 1}`);
    }
  }
  return found;
}

describe("saffron discipline (R-197 / R-260)", () => {
  test("the source tree is actually being walked", () => {
    // Guards against the walk finding nothing and every assertion below
    // passing vacuously.
    expect(sourceFilesUnder(SRC).length).toBeGreaterThan(200);
  });

  test("no app surface paints a WORD in saffron", () => {
    expect(offenders(SAFFRON_AS_TEXT, TEXT_RULE_EXEMPT_DIR)).toEqual([]);
  });

  test("nothing anywhere puts white text on a saffron fill", () => {
    // No exemption: 2.60:1 is 2.60:1 on every surface, because both colours
    // are fixed. --brand-fill-deep is the answer where white is required.
    expect(offenders(WHITE_ON_SAFFRON)).toEqual([]);
  });

  test("the marketing exemption really is narrow", () => {
    // If someone widens TEXT_RULE_EXEMPT_DIR to, say, src/components, this
    // fails -- the exemption is for one directory with one stated reason.
    expect(TEXT_RULE_EXEMPT_DIR).toBe(join("src", "components", "marketing"));
  });

  test("the patterns actually match the things they are meant to catch", () => {
    // A guard that cannot fail is not a guard. These are the exact shapes the
    // R66 audit found on live screens.
    expect(SAFFRON_AS_TEXT.test('className="text-px-orange hover:underline"')).toBe(true);
    expect(SAFFRON_AS_TEXT.test('className="text-ct-saffron"')).toBe(true);
    expect(SAFFRON_AS_TEXT.test('className="text-[color:var(--color-ct-saffron)]"')).toBe(true);
    expect(WHITE_ON_SAFFRON.test('className="bg-ct-saffron text-white text-xs font-bold"')).toBe(true);
    expect(WHITE_ON_SAFFRON.test('className="bg-px-orange px-8 text-base text-white"')).toBe(true);
    expect(WHITE_ON_SAFFRON.test('className="bg-px-orange/80 text-[10px] text-white"')).toBe(true);

    // ...and do NOT match the legitimate replacements.
    expect(SAFFRON_AS_TEXT.test('className="text-brand-text hover:underline"')).toBe(false);
    expect(WHITE_ON_SAFFRON.test('className="bg-brand-fill-deep text-white"')).toBe(false);
    expect(WHITE_ON_SAFFRON.test('className="bg-ct-saffron text-ct-navy"')).toBe(false);
    // A saffron fill on its own is fine -- that is what saffron is for.
    expect(WHITE_ON_SAFFRON.test('className="bg-px-orange/20"')).toBe(false);
  });
});
