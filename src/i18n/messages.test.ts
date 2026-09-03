/// <reference types="bun-types" />
// R67 J-01 fix pass (audit R-246). The Hindi marketing document is only worth
// prerendering if it genuinely carries Hindi -- a per-locale route that
// silently loaded the English catalogue would look right in every structural
// check and be wrong in the browser. This loads both catalogues the same way
// the pages do and asserts they are actually different documents.
import { describe, expect, test } from "bun:test";
import { loadMessages } from "./messages";
import { SUPPORTED_LOCALES } from "./locales";

const DEVANAGARI = /[ऀ-ॿ]/;

describe("loadMessages", () => {
  test("every supported locale has a real catalogue behind it", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = await loadMessages(locale);
      expect(Object.keys(messages).length).toBeGreaterThan(0);
      expect(messages.Marketing).toBeDefined();
    }
  });

  test("the Hindi catalogue is Hindi, not a copy of the English one", async () => {
    const en = (await loadMessages("en")) as Record<string, Record<string, Record<string, string>>>;
    const hi = (await loadMessages("hi")) as Record<string, Record<string, Record<string, string>>>;

    // The exact string the J-01/J-02 acceptance asserts on the English page.
    expect(en.Marketing.hero.headingLine1).toBe("Every deadline, drawing and decision.");
    expect(hi.Marketing.hero.headingLine1).not.toBe(en.Marketing.hero.headingLine1);
    expect(hi.Marketing.hero.headingLine1).toMatch(DEVANAGARI);
  });

  test("both catalogues carry the whole Marketing tree the two public pages render", async () => {
    // Named individually rather than "same keys", because the point is that
    // the sections a prospect sees are all translated -- this is what makes
    // serving the Hindi document worth a second prerender.
    const sections = [
      "header",
      "hero",
      "problem",
      "solution",
      "system",
      "moduleCatalog",
      "copilot",
      "value",
      "roi",
      "selfCoordination",
      "finalCta",
      "contactForm",
      "footer",
      "howItWorks",
    ];
    for (const locale of SUPPORTED_LOCALES) {
      const messages = (await loadMessages(locale)) as Record<string, Record<string, unknown>>;
      for (const section of sections) {
        expect(`${locale}.Marketing.${section}: ${messages.Marketing[section] !== undefined}`).toBe(
          `${locale}.Marketing.${section}: true`
        );
      }
    }
  });

  test("the /how-it-works back link is translated in both locales", async () => {
    // Added by this change: the only string on those pages that used to be
    // hard-coded English JSX.
    const en = (await loadMessages("en")) as Record<string, Record<string, Record<string, string>>>;
    const hi = (await loadMessages("hi")) as Record<string, Record<string, Record<string, string>>>;
    expect(en.Marketing.howItWorks.backToHome).toBe("Back to projexa-ai.com");
    expect(hi.Marketing.howItWorks.backToHome).toMatch(DEVANAGARI);
  });
});
