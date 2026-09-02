/// <reference types="bun-types" />
// R67 lane D22 (items D-58/D-63). The wa.me payload is the one piece of
// ShareSheet that is pure and that an acceptance clause names literally:
// the href must start with https://wa.me/?text= and must contain the share
// link, with R-203's one-line summary ahead of it.
import { describe, expect, test } from "bun:test";
import { whatsappHrefFor } from "./ShareSheet";

const SHARE_URL = "https://veridian-compliance-ai.vercel.app/shared/meeting/abc123token";

describe("whatsappHrefFor", () => {
  test("is a wa.me link carrying the share URL", () => {
    const href = whatsappHrefFor(SHARE_URL);
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toBe(SHARE_URL);
  });

  test("puts the one-line summary ahead of the link, on its own line", () => {
    const summary = "MoM - Weekly Site Coordination - 28 Aug 2026 - 4 actions";
    const href = whatsappHrefFor(SHARE_URL, summary);
    const text = decodeURIComponent(href.slice("https://wa.me/?text=".length));
    expect(text).toBe(`${summary}\n${SHARE_URL}`);
    expect(text.indexOf(summary)).toBeLessThan(text.indexOf(SHARE_URL));
  });

  test("percent-encodes the payload so a summary with spaces and dashes survives", () => {
    const href = whatsappHrefFor(SHARE_URL, "MoM - Kick off");
    expect(href).not.toContain(" ");
    expect(href).toContain("%20");
  });
});
