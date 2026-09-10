/// <reference types="bun-types" />
// R74-RULING-03 closure test for R-62 ("Dashboard and other screens show
// AED"). R38 (23 Aug) found and fixed the real root cause live: the hardcoded
// rupee fallback in currencyLabel() (PR history in ./currency.ts's own header)
// -- and currency.test.ts's own "falls back rather than inventing a symbol"
// test already proves the rupee/dollar symbol can never come back. What
// neither proves is the SPECIFIC deployed configuration: that with
// NEXT_PUBLIC_DEFAULT_CURRENCY_CODE=AED (projexa-ai.com's real Vercel env,
// per this codebase's own R38 evidence), the fallback actually resolves to
// "AED ", not just "not a hardcoded symbol". R-62's own next_action named
// this exact gap: "live-UI confirmation that an authenticated money screen
// renders AED... NOT YET DONE." A live browser session cannot be a committed,
// re-runnable test, but the exact module-load computation the browser would
// run can -- so this is that computation, pinned.
//
// SEPARATE FILE, not added to currency.test.ts, because DEFAULT_CURRENCY_CODE
// is computed ONCE from process.env at module import time (./currency.ts's
// own top-level `const`) -- this file must set the env var BEFORE its first
// import of the module, which currency.test.ts's own many tests (importing
// the module at ITS top, unaware of this concern) must never see. bun test
// --isolate (this repo's own CI invocation, .github/workflows/ci.yml) runs
// each test file in its own process, so this is safe.
import { describe, expect, test } from "bun:test"

// Set BEFORE the only import of ./currency in this process -- ES module
// specifiers are cached per realm, so a second test in this same file
// re-importing "./currency" after changing the env would silently observe
// the FIRST import's already-computed value, not a fresh one (caught by
// actually running a two-scenario version of this file before writing this
// comment: the second case failed on "AED " leaking into an unset-env
// expectation). One deployed scenario, one file, matching how --isolate
// (this repo's own CI invocation) actually isolates by FILE, not by test.
process.env.NEXT_PUBLIC_DEFAULT_CURRENCY_CODE = "AED"

describe("CURRENCY_FALLBACK_LABEL with the real deployed env (R-62)", () => {
  test("NEXT_PUBLIC_DEFAULT_CURRENCY_CODE=AED (projexa-ai.com's actual Vercel setting) resolves the fallback to exactly 'AED ', a CODE not a symbol", async () => {
    const { CURRENCY_FALLBACK_LABEL, currencyLabel } = await import("./currency")

    expect(CURRENCY_FALLBACK_LABEL).toBe("AED ")
    // The exact call shape every one of the ~30 real call sites makes before
    // useCurrencies() has answered: no id, no currencies loaded yet.
    expect(currencyLabel(undefined, [])).toBe("AED ")
    expect(currencyLabel(null, [])).toBe("AED ")
  })
})
