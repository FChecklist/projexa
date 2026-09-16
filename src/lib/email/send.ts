import { Resend } from "resend";

// WO-PROJEXA-AI-LINK-001 Part 2: email as the interface. Domain split, per
// the work order -- the bare projexa-ai.com stays for human mail; sending
// goes out from a dedicated subdomain so it never shares SPF/DKIM/DMARC
// reputation with anything else on the apex domain.
//
// NEITHER send.projexa-ai.com NOR reply.projexa-ai.com is configured in DNS
// yet -- that is a real domain-registrar action outside this session's tool
// reach (and, separately, exactly the kind of live/production change that
// needs the domain owner's own hand, the same posture this repo already
// takes on Vercel deploys). FROM_DOMAIN is an env var for that reason: the
// code is ready the moment the subdomain exists and Resend is configured
// against it, without another code change.
const FROM_DOMAIN = process.env.EMAIL_FROM_DOMAIN ?? "send.projexa-ai.com";
export const FROM = process.env.EMAIL_FROM ?? `PROJEXA <noreply@${FROM_DOMAIN}>`;
export const REPLY_DOMAIN = process.env.EMAIL_REPLY_DOMAIN ?? "reply.projexa-ai.com";

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

/** Same graceful-no-op-without-a-key posture as compliance-tracker's src/lib/email.ts -- local dev and a cold-started environment never crash on a missing key, they just don't send. */
export async function sendEmail(payload: EmailPayload): Promise<{ sent: boolean }> {
  const client = getResend();
  if (!client) {
    console.warn("[email] RESEND_API_KEY not set -- email skipped:", payload.subject);
    return { sent: false };
  }
  const { error } = await client.emails.send({
    from: FROM,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
  });
  if (error) {
    console.error("[email] send error:", error);
    return { sent: false };
  }
  return { sent: true };
}

export function emailTemplate(title: string, bodyHtml: string, actions: Array<{ label: string; url: string }> = []): string {
  const actionButtons = actions
    .map(
      (a, i) =>
        `<a href="${a.url}" style="display:inline-block;margin:${i === 0 ? "20px" : "0"} 8px 0 0;padding:11px 22px;background:${
          i === 0 ? "#F5820A" : "#FFFFFF"
        };color:${i === 0 ? "#1C2B3A" : "#1C2B3A"};border:1px solid #E2E8F0;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">${a.label}</a>`
    )
    .join("");
  return `
<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#FFFDF9;margin:0;padding:32px 16px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #E2E8F0;overflow:hidden;">
  <div style="background:#1C2B3A;padding:20px 24px;">
    <span style="color:#F5820A;font-size:17px;font-weight:700;">PROJEXA</span>
  </div>
  <div style="padding:24px;">
    <h2 style="color:#1C2B3A;margin:0 0 12px;font-size:18px;">${title}</h2>
    <div style="color:#4B5568;font-size:14px;line-height:1.6;">${bodyHtml}</div>
    <div>${actionButtons}</div>
  </div>
  <div style="background:#F8FAFC;padding:14px 24px;border-top:1px solid #E2E8F0;">
    <p style="color:#8B94A3;font-size:11px;margin:0;">PROJEXA — One link, one tap, any phone.</p>
  </div>
</div>
</body></html>`;
}
