/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { buildWelcomeEmail, escapeHtml, formatExpiry, WELCOME_AI_PROMPT_PREFIX, WELCOME_LINK_DAYS, WELCOME_LINK_LABEL } from "./welcome-ai-prompt";
import { AI_PROMPT_PREFIX } from "@/components/ai-link/AiWorkLinkCompact";

// AUDIT-100 B55: the welcome e-mail's template. What is pinned here, on the exact strings handed to Resend:
//   - the link (a credential) is NEVER inside an href: a mail scanner following links would otherwise use it before the person does;
//   - it IS inside the plain-text copy box, preceded by the owner-approved prompt, and in the text part;
//   - the expiry is stated, and what the link may do follows the level the service minted for the role (0 = read and draft only);
//   - an organisation name is HTML-escaped.

const TOKEN = `pxa_${"ab12".repeat(16)}`;
const LINK = `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link/${TOKEN}`;
const base = { organizationName: "Acme Builders", link: LINK, expiresAt: "2026-10-07T09:05:00Z", level: 0 as const, appUrl: "https://projexa-ai.com" };

/** Every href value in a piece of HTML (quoted with " or ', or bare). */
function hrefsOf(html: string): string[] {
  return Array.from(html.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)).map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/** The rule the tests enforce: no href carries the token or the link. */
function linkInAnyHref(html: string): boolean {
  return hrefsOf(html).some((h) => h.includes(TOKEN) || h.includes("ai-work-link/"));
}

describe("welcome e-mail with the personal AI prompt (B55)", () => {
  test("the prompt is the owner-approved wording, the same text the app's Copy AI prompt button uses", () => {
    expect(WELCOME_AI_PROMPT_PREFIX).toBe(AI_PROMPT_PREFIX);
    const { html, text } = buildWelcomeEmail(base);
    expect(text).toContain(WELCOME_AI_PROMPT_PREFIX + LINK);
    // in the HTML the prompt + link sit together inside the one <pre> copy box
    const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? "";
    expect(pre).toBe(escapeHtml(WELCOME_AI_PROMPT_PREFIX + LINK));
  });

  test("no token and no link in any href; the only hyperlink is the token-free app address", () => {
    const { html } = buildWelcomeEmail(base);
    expect(linkInAnyHref(html)).toBe(false);
    expect(hrefsOf(html)).toEqual(["https://projexa-ai.com"]);
    // the token appears exactly once in the HTML: in the copy box
    expect(html.split(TOKEN).length - 1).toBe(1);
  });

  test("SEEN TO FAIL: the same check catches a template that puts the link in an href", () => {
    const { html } = buildWelcomeEmail(base);
    const broken = html.replace("</pre>", `</pre><a href="${LINK}">Open your guide</a>`);
    expect(linkInAnyHref(broken)).toBe(true);
    const brokenSingle = html.replace("</pre>", `</pre><a href='${LINK}'>x</a>`);
    expect(linkInAnyHref(brokenSingle)).toBe(true);
  });

  test("the expiry is stated, in 24 hours, with the exact UTC time, in both parts", () => {
    const { html, text } = buildWelcomeEmail(base);
    expect(formatExpiry(base.expiresAt)).toBe("7 Oct 2026, 09:05 UTC");
    for (const part of [html, text]) {
      expect(part).toContain("It stops working in 24 hours (7 Oct 2026, 09:05 UTC).");
      expect(part).toContain("Copy AI prompt");
    }
    expect(WELCOME_LINK_DAYS).toBe(1);
    expect(WELCOME_LINK_LABEL).toBe("Welcome email");
  });

  test("the role limit: a level 0 link (read-only roles) says read and draft only; level 1 says it can make changes", () => {
    const read = buildWelcomeEmail({ ...base, level: 0 });
    expect(read.text).toContain("This link can read and draft only. It cannot change anything.");
    expect(read.text).not.toContain("make changes");
    const write = buildWelcomeEmail({ ...base, level: 1 });
    expect(write.text).toContain("This link can also make changes for you, as your role allows. Keep it private.");
    expect(write.text).not.toContain("read and draft only");
  });

  test("two plain steps, the organisation in the subject and heading, and an organisation name is escaped", () => {
    const { subject, html, text } = buildWelcomeEmail({ ...base, organizationName: `<b>Evil & "Co"</b>` });
    expect(subject).toBe(`Welcome to <b>Evil & "Co"</b> on PROJEXA`);
    expect(html).toContain("Welcome to &lt;b&gt;Evil &amp; &quot;Co&quot;&lt;/b&gt;");
    expect(html).not.toContain("<b>Evil");
    expect(text).toContain("Copy all of the text in the box below. Paste it into your own AI assistant");
    expect(buildWelcomeEmail({ ...base, organizationName: null }).subject).toBe("Welcome to your team on PROJEXA");
  });
});
