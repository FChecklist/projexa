// AUDIT-100 B55: after a person ACCEPTS an invitation (src/app/api/org/invites/accept/route.ts), send them ONE "Welcome to <org>" e-mail
// with their own personalised AI prompt (src/lib/email/welcome-ai-prompt.ts).
//
// THE LINK is minted for THIS person with THEIR OWN session, through the same service the app's "Copy AI prompt" button uses (the
// `ai-work-link` Edge Function, POST /user-link -- see src/lib/ai-work-link-core.ts for the contract). Nothing here picks a level: the
// request carries no level, so the service mints the highest level the person's role allows and no more (a client_viewer gets a read-only
// link). It is a 24-hour link labelled "Welcome email", so the person can see and revoke it in their own list.
//
// FAIL-SOFT, NEVER BLOCKING. The membership is already made when this runs. Every reason not to send is logged (one line, no token, no link,
// no address) and returned; nothing here throws:
//   - no e-mail address on the session                      -> skipped "no_email"
//   - the person already has an active link for all projects -> skipped "has_link" (minting a new one would revoke theirs: the service keeps
//                                                               one such link per person)
//   - the mint is refused or fails (for example an account not yet linked to a VERIDIAN user: 403 USER_NOT_LINKED) -> skipped "mint_failed"
//   - Resend is not configured or refuses                   -> "send_failed"
// The token lives only in this function's memory and in the e-mail body; it is never logged.
import { AWL_URL, createAwlClient, type AwlClient, type AwlSession } from "@/lib/ai-work-link-core";
import { sendEmail, type EmailPayload } from "@/lib/email/send";
import { buildWelcomeEmail, WELCOME_LINK_DAYS, WELCOME_LINK_LABEL } from "@/lib/email/welcome-ai-prompt";

export type WelcomeOutcome =
  | { status: "sent"; emailId: string | null; linkId: string; level: 0 | 1 }
  | { status: "skipped"; reason: "no_email" | "has_link" | "mint_failed" }
  | { status: "send_failed"; linkId: string };

/** The parts of a server Supabase client this uses (the real one in the route, a fake in the tests). */
export type WelcomeSupabase = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token: string } | null } }>;
    refreshSession: () => Promise<{ data: { session: { access_token: string } | null } }>;
  };
  // the query builder of supabase-js (select/eq/maybeSingle); typed loosely so a fake can stand in for it
  from: (table: string) => any;
};

export type WelcomeDeps = {
  /** Defaults to a client of the real service using the session below. */
  awl?: AwlClient;
  send?: (payload: EmailPayload) => Promise<{ sent: boolean; id?: string }>;
  log?: (line: string) => void;
  appUrl?: string;
  /** Seconds since the epoch (tests). */
  nowSeconds?: () => number;
};

/** The service refuses to mint with a session older than 15 minutes (SESSION_STALE); refresh well before that. */
const FRESH_SECONDS = 10 * 60;

function iatOf(jwt: string): number | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { iat?: unknown };
    return typeof json.iat === "number" ? json.iat : null;
  } catch {
    return null;
  }
}

/** The person's session token, refreshed first when it is old enough that the mint would call it stale. */
export function freshSession(supabase: WelcomeSupabase, nowSeconds: () => number): AwlSession {
  return {
    accessToken: async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
      const iat = token ? iatOf(token) : null;
      if (token && iat !== null && nowSeconds() - iat < FRESH_SECONDS) return token;
      return (await supabase.auth.refreshSession()).data.session?.access_token ?? null;
    },
    refresh: async () => (await supabase.auth.refreshSession()).data.session?.access_token ?? null,
  };
}

async function organizationName(supabase: WelcomeSupabase, organizationId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle();
    return typeof data?.name === "string" ? data.name : null;
  } catch {
    return null;
  }
}

export async function sendInviteWelcome(
  supabase: WelcomeSupabase,
  person: { email: string | null | undefined },
  organizationId: string,
  deps: WelcomeDeps = {},
): Promise<WelcomeOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const email = typeof person.email === "string" ? person.email.trim() : "";
  if (!email) {
    log("[invite-welcome] skipped: the account has no e-mail address");
    return { status: "skipped", reason: "no_email" };
  }
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const awl = deps.awl ?? createAwlClient({ session: freshSession(supabase, nowSeconds), baseUrl: AWL_URL });

  let minted;
  try {
    // A person who already has a working link for all their projects keeps it: a new one would revoke it.
    if (!awl.listAllLinks) throw new Error("the link client cannot list links");
    const existing = await awl.listAllLinks();
    if (existing.some((l) => l.scope === "user" && l.status === "active")) {
      log("[invite-welcome] skipped: the person already has an active link for all projects");
      return { status: "skipped", reason: "has_link" };
    }
    minted = await awl.mintUserLink({ days: WELCOME_LINK_DAYS, label: WELCOME_LINK_LABEL });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "unknown";
    const status = err && typeof err === "object" && "status" in err ? String((err as { status: unknown }).status) : "?";
    log(`[invite-welcome] skipped: no link could be made (${status} ${code})`);
    return { status: "skipped", reason: "mint_failed" };
  }

  const message = buildWelcomeEmail({
    organizationName: await organizationName(supabase, organizationId),
    link: minted.link,
    expiresAt: minted.expiresAt,
    level: minted.level,
    appUrl: deps.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://projexa-ai.com",
  });
  let sent: { sent: boolean; id?: string };
  try {
    sent = await (deps.send ?? sendEmail)({ to: email, subject: message.subject, html: message.html, text: message.text });
  } catch {
    sent = { sent: false };
  }
  if (!sent.sent) {
    log(`[invite-welcome] the e-mail was not sent (link ${minted.linkId} made, level ${minted.level})`);
    return { status: "send_failed", linkId: minted.linkId };
  }
  log(`[invite-welcome] sent (e-mail ${sent.id ?? "?"}, link ${minted.linkId}, level ${minted.level})`);
  return { status: "sent", emailId: sent.id ?? null, linkId: minted.linkId, level: minted.level };
}
