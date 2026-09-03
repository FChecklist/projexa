import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";
// R67 D-61: the one money/number/date formatting rule, defined once in
// eslint-rules/money-format.mjs and consumed both here (as the lint error) and
// by src/lib/money-format-rule.test.ts (which keeps NOT_YET_SWEPT honest).
import { BANNED_METHODS, NOT_YET_SWEPT, RULE_FILES, RULE_MESSAGE } from "./eslint-rules/money-format.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// R67 WS-G (R-197 / R-260): the editor half of the saffron rule. #F5820A is a
// FILL -- as text on the app's cream it measures 2.56:1, and white on it
// measures 2.60:1, which is what made every primary button in this app fail
// WCAG AA. `text-brand-text` (#9A4D0A, 6.01:1) is the brand-coloured WORD,
// and `bg-brand-fill-deep` (#A8540A, white at 5.33:1) is correction C-13's
// fill for the rare control where white text is unavoidable.
//
// This selector matches a className written as a plain string literal, which
// is the shape that gets typed by hand and therefore the one worth catching
// AS you type it. Template literals and cn() calls are covered by
// src/lib/saffron-discipline.test.ts, which scans the source directly -- the
// two halves together are the rule.
const SAFFRON_TEXT_MESSAGE =
  "Saffron is a fill, never text: #F5820A on cream is 2.56:1 (WCAG AA needs 4.5:1). Use text-brand-text for a brand-coloured word, or text-ct-navy on a saffron fill.";
const WHITE_ON_SAFFRON_MESSAGE =
  "White on a saffron fill is 2.60:1. The default is navy on saffron (5.55:1) -- which --primary-foreground already gives every shadcn Button -- or bg-brand-fill-deep with white (5.33:1, correction C-13).";

const saffronDiscipline = {
  files: ["src/**/*.tsx"],
  // The marketing landing page (src/components/marketing) sits on navy, where
  // saffron text is 5.55:1 and passes; the app surfaces are cream. Only the
  // TEXT half is exempt there -- white-on-saffron is caught everywhere,
  // because both of those colours are fixed.
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "JSXAttribute[name.name='className'] > Literal[value=/\\btext-(px-orange|ct-saffron)\\b/]",
        message: SAFFRON_TEXT_MESSAGE,
      },
      {
        selector:
          "JSXAttribute[name.name='className'] > Literal[value=/\\bbg-(px-orange|ct-saffron)(\\/\\d+)?\\b[^\"']*\\btext-white\\b/]",
        message: WHITE_ON_SAFFRON_MESSAGE,
      },
      {
        selector:
          "JSXAttribute[name.name='className'] > Literal[value=/\\btext-white\\b[^\"']*\\bbg-(px-orange|ct-saffron)(\\/\\d+)?\\b/]",
        message: WHITE_ON_SAFFRON_MESSAGE,
      },
    ],
  },
};

const marketingSaffronTextAllowed = {
  files: ["src/components/marketing/**/*.tsx"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "JSXAttribute[name.name='className'] > Literal[value=/\\bbg-(px-orange|ct-saffron)(\\/\\d+)?\\b[^\"']*\\btext-white\\b/]",
        message: WHITE_ON_SAFFRON_MESSAGE,
      },
      {
        selector:
          "JSXAttribute[name.name='className'] > Literal[value=/\\btext-white\\b[^\"']*\\bbg-(px-orange|ct-saffron)(\\/\\d+)?\\b/]",
        message: WHITE_ON_SAFFRON_MESSAGE,
      },
    ],
  },
};

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    // eslint-plugin-react-hooks v7's new React Compiler rule -- flags the
    // standard "fetch in useEffect, setState when the async load() resolves"
    // pattern used by virtually every page in this app (confirmed via a
    // minimal repro: even a single useState+single fetch+single setState
    // trips it), so enforcing it as an error would require rewriting every
    // existing data-fetching page. Matches the same rationale as the two
    // rules above it.
    "react-hooks/set-state-in-effect": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, saffronDiscipline, marketingSaffronTextAllowed, {
  // R67 D-61 (audit R-198/R-226): "One money, date and number format across
  // every screen", made enforceable.
  //
  // Scoped to the two directories that RENDER -- src/lib/format-money.ts and
  // src/lib/format-date.ts are the modules that legitimately call these
  // methods, and they are the only ones that should. `ignores` here narrows
  // this block only: it is the shrinking list of screens the sweep has not
  // reached, not a set of approved exceptions -- see the file it comes from.
  files: RULE_FILES,
  ignores: NOT_YET_SWEPT,
  rules: {
    "no-restricted-syntax": [
      "error",
      ...BANNED_METHODS.map((name) => ({
        selector: `CallExpression > MemberExpression.callee > Identifier.property[name='${name}']`,
        message: RULE_MESSAGE,
      })),
    ],
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;
