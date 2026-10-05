// AUDIT-100 B55: the "Welcome to <org>" e-mail an invited person gets when they ACCEPT an invitation, carrying their own personalised AI
// prompt. PURE: no network, no env, no Supabase -- it turns (organisation name, the minted link, its expiry, its level) into subject + HTML +
// plain text, so the tests can pin every rule below on the exact strings that go to Resend.
//
// THE RULES (owner, via the PM, 2026-10-06; DPDP's e-mail paste box is the model -- compliance-tracker supabase/functions/dpdp-monday-email):
//   1. The link is a credential. It appears ONLY as plain text inside a copy box, NEVER in an href: a mail scanner that follows every link
//      in a message would otherwise "use" (and, with an unfamiliar-use alert, flag) it before the person ever sees it. The only hyperlink in
//      the whole message is the token-free address of PROJEXA itself.
//   2. The prompt is the owner-approved wording (AI_PROMPT_PREFIX of src/components/ai-link/AiWorkLinkCompact.tsx, kept in step by a test:
//      that file is a client component, so a server module must not import from it).
//   3. Two short sentences on what to do, the link's limit in one sentence (level 0 = read and draft only, as the mint chose for the role),
//      and when it stops working. Short sentences: customer-facing copy (owner rule).
//   4. Everything that came from a person (the organisation name) is HTML-escaped; the link is escaped too.

export const WELCOME_AI_PROMPT_PREFIX =
  "PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): ";

/** The label the link carries in the person's own link list ("My AI links"), so they can tell it apart and revoke it. */
export const WELCOME_LINK_LABEL = "Welcome email";
/** Days the e-mailed link lives: 1 = 24 hours (a one-off mail, the DPDP rule). */
export const WELCOME_LINK_DAYS = 1 as const;

export type WelcomeEmailInput = {
  organizationName: string | null;
  /** The minted link (with its token). Goes into the copy box and the text part only. */
  link: string;
  /** ISO time the link stops working. */
  expiresAt: string;
  /** The level the service minted for this person's role: 0 = read and draft only, 1 = direct changes. */
  level: 0 | 1;
  /** The token-free address of PROJEXA (the one hyperlink). */
  appUrl: string;
};

export type WelcomeEmail = { subject: string; html: string; text: string };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "6 Oct 2026, 14:05 UTC": unambiguous for any reader, no locale of the server involved. */
export function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "in 24 hours";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function levelSentence(level: 0 | 1): string {
  return level === 0
    ? "This link can read and draft only. It cannot change anything."
    : "This link can also make changes for you, as your role allows. Keep it private.";
}

export function buildWelcomeEmail(input: WelcomeEmailInput): WelcomeEmail {
  const org = (input.organizationName ?? "").trim() || "your team";
  const prompt = WELCOME_AI_PROMPT_PREFIX + input.link;
  const expiry = `It stops working in 24 hours (${formatExpiry(input.expiresAt)}). After that, use "Copy AI prompt" in PROJEXA for a new one.`;
  const todo1 = "Copy all of the text in the box below.";
  const todo2 = "Paste it into your own AI assistant, such as ChatGPT or Claude, and it will work in PROJEXA for you.";
  const subject = `Welcome to ${org} on PROJEXA`;

  const text = [
    `Welcome to ${org} on PROJEXA.`,
    "",
    `${todo1} ${todo2}`,
    "",
    "----- copy from here -----",
    prompt,
    "----- to here -----",
    "",
    levelSentence(input.level),
    expiry,
    "Only paste it into an assistant that only you use.",
    "",
    `Open PROJEXA: ${input.appUrl}`,
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 10px;">${s}</p>`;
  const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#FFFDF9;margin:0;padding:32px 16px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #E2E8F0;overflow:hidden;">
  <div style="background:#1C2B3A;padding:20px 24px;"><span style="color:#F5820A;font-size:17px;font-weight:700;">PROJEXA</span></div>
  <div style="padding:24px;color:#4B5568;font-size:14px;line-height:1.6;">
    <h2 style="color:#1C2B3A;margin:0 0 12px;font-size:18px;">Welcome to ${escapeHtml(org)}</h2>
    ${p(escapeHtml(todo1))}
    ${p(escapeHtml(todo2))}
    <pre style="white-space:pre-wrap;word-break:break-all;font-family:Consolas,Menlo,monospace;font-size:13px;color:#1C2B3A;background:#F8FAFC;border:1px dashed #94A3B8;border-radius:8px;padding:14px;margin:14px 0;">${escapeHtml(prompt)}</pre>
    ${p(escapeHtml(levelSentence(input.level)))}
    ${p(escapeHtml(expiry))}
    ${p("Only paste it into an assistant that only you use.")}
    <p style="margin:18px 0 0;"><a href="${escapeHtml(input.appUrl)}" style="color:#0E7C6E;font-weight:600;">Open PROJEXA</a></p>
  </div>
</div>
</body></html>`;

  return { subject, html, text };
}
