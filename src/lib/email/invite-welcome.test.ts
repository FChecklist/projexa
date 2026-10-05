/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { freshSession, sendInviteWelcome, type WelcomeSupabase } from "./invite-welcome";
import { AwlError, type AwlClient, type AwlLinkRow, type AwlMinted } from "@/lib/ai-work-link-core";
import type { EmailPayload } from "./send";

// AUDIT-100 B55: the welcome e-mail sender run after an invitation is accepted. Proven here with a fake link service and a fake mailer:
// the link is minted for the person with NO level (the service picks the highest their role allows), 24 hours, label "Welcome email"; one
// e-mail goes to the person's own address; every failure is a logged skip that never throws; a person's existing link for all projects is
// left alone; and no log line ever carries the token or the link.

const TOKEN = `pxa_${"cd34".repeat(16)}`;
const LINK = `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link/${TOKEN}`;

function minted(level: 0 | 1 = 0): AwlMinted {
  return { linkId: "lnk1", level, expiresAt: "2026-10-07T09:05:00Z", label: "Welcome email", project: null, link: LINK, inbox: null, notice: "", shell: false };
}

function fakeAwl(over: { rows?: AwlLinkRow[]; mint?: () => Promise<AwlMinted>; list?: () => Promise<AwlLinkRow[]> } = {}) {
  const calls: Array<{ fn: string; input?: unknown }> = [];
  const awl: AwlClient = {
    warning: async () => { throw new Error("not used"); },
    mint: async () => { throw new Error("not used"); },
    links: async () => { throw new Error("not used"); },
    revoke: async () => { throw new Error("not used"); },
    newProject: async () => { throw new Error("not used"); },
    listAllLinks: async () => { calls.push({ fn: "listAllLinks" }); return over.list ? over.list() : over.rows ?? []; },
    mintUserLink: async (input) => { calls.push({ fn: "mintUserLink", input }); return over.mint ? over.mint() : minted(); },
  };
  return { awl, calls };
}

function fakeSupabase(orgName: string | null = "Acme Builders"): WelcomeSupabase {
  return {
    auth: { getSession: async () => ({ data: { session: null } }), refreshSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: orgName === null ? null : { name: orgName } }) }) }) }),
  };
}

function harness(opts: { send?: (p: EmailPayload) => Promise<{ sent: boolean; id?: string }> } = {}) {
  const sent: EmailPayload[] = [];
  const logs: string[] = [];
  return {
    sent,
    logs,
    deps: {
      send: opts.send ?? (async (p: EmailPayload) => { sent.push(p); return { sent: true, id: "em_1" }; }),
      log: (l: string) => logs.push(l),
      appUrl: "https://projexa-ai.com",
    },
  };
}

const row = (over: Partial<AwlLinkRow>): AwlLinkRow => ({ id: "x", projectId: "", projectName: null, label: null, level: 0, createdAt: null, expiresAt: "", revokedAt: null, lastUsedAt: null, status: "active", ...over });

describe("sendInviteWelcome (B55)", () => {
  test("mints ONE 24-hour 'Welcome email' link with no level (the role decides) and sends ONE e-mail to the person", async () => {
    const { awl, calls } = fakeAwl();
    const h = harness();
    const out = await sendInviteWelcome(fakeSupabase(), { email: " new.person@example.com " }, "org-1", { ...h.deps, awl });
    expect(out).toEqual({ status: "sent", emailId: "em_1", linkId: "lnk1", level: 0 });
    expect(calls).toEqual([{ fn: "listAllLinks" }, { fn: "mintUserLink", input: { days: 1, label: "Welcome email" } }]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe("new.person@example.com");
    expect(h.sent[0].subject).toBe("Welcome to Acme Builders on PROJEXA");
    expect(h.sent[0].text).toContain(LINK);
    expect(h.sent[0].html).toContain(LINK);
    expect(h.sent[0].html).not.toMatch(new RegExp(`href=["'][^"']*${TOKEN}`));
    expect(h.sent[0].text).toContain("read and draft only");
  });

  test("the level the service minted reaches the e-mail (a member's level 1 link says it can make changes)", async () => {
    const { awl } = fakeAwl({ mint: async () => minted(1) });
    const h = harness();
    const out = await sendInviteWelcome(fakeSupabase(), { email: "pm@example.com" }, "org-1", { ...h.deps, awl });
    expect(out).toMatchObject({ status: "sent", level: 1 });
    expect(h.sent[0].text).toContain("can also make changes");
  });

  test("no e-mail address: skipped and logged, nothing minted, nothing sent", async () => {
    const { awl, calls } = fakeAwl();
    const h = harness();
    for (const email of [null, undefined, "   "]) {
      expect(await sendInviteWelcome(fakeSupabase(), { email }, "org-1", { ...h.deps, awl })).toEqual({ status: "skipped", reason: "no_email" });
    }
    expect(calls).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.logs.every((l) => l.includes("skipped"))).toBe(true);
  });

  test("the mint is refused (e.g. 403 USER_NOT_LINKED) or the service is down: skipped, nothing sent, never throws", async () => {
    for (const fail of [
      async () => { throw new AwlError("Your PROJEXA account is not linked to a PROJEXA user - ask your admin", 403, "USER_NOT_LINKED"); },
      async () => { throw new AwlError("Could not reach the AI work link service.", 0, "NETWORK"); },
      async () => { throw new Error("boom"); },
    ]) {
      const { awl } = fakeAwl({ mint: fail });
      const h = harness();
      expect(await sendInviteWelcome(fakeSupabase(), { email: "a@example.com" }, "org-1", { ...h.deps, awl })).toEqual({ status: "skipped", reason: "mint_failed" });
      expect(h.sent).toEqual([]);
    }
    const { awl } = fakeAwl({ list: async () => { throw new AwlError("down", 503, "MINT_UNAVAILABLE"); } });
    const h = harness();
    expect(await sendInviteWelcome(fakeSupabase(), { email: "a@example.com" }, "org-1", { ...h.deps, awl })).toEqual({ status: "skipped", reason: "mint_failed" });
    expect(h.logs.join("\n")).toContain("503 MINT_UNAVAILABLE");
  });

  test("a person who already has an active link for all projects keeps it: no mint (it would revoke theirs), no e-mail", async () => {
    const { awl, calls } = fakeAwl({ rows: [row({ scope: "project", status: "active" }), row({ scope: "user", status: "active" })] });
    const h = harness();
    expect(await sendInviteWelcome(fakeSupabase(), { email: "a@example.com" }, "org-1", { ...h.deps, awl })).toEqual({ status: "skipped", reason: "has_link" });
    expect(calls.map((c) => c.fn)).toEqual(["listAllLinks"]);
    expect(h.sent).toEqual([]);
    // an expired/revoked link for all projects, or a project link, does not count
    const other = fakeAwl({ rows: [row({ scope: "user", status: "revoked" }), row({ scope: "user", status: "expired" }), row({ scope: "project", status: "active" })] });
    const h2 = harness();
    expect((await sendInviteWelcome(fakeSupabase(), { email: "a@example.com" }, "org-1", { ...h2.deps, awl: other.awl })).status).toBe("sent");
  });

  test("Resend not configured or refusing: send_failed, never throws", async () => {
    const { awl } = fakeAwl();
    const h = harness({ send: async () => ({ sent: false }) });
    expect(await sendInviteWelcome(fakeSupabase(), { email: "a@example.com" }, "org-1", { ...h.deps, awl })).toEqual({ status: "send_failed", linkId: "lnk1" });
    const throwing = harness({ send: async () => { throw new Error("smtp down"); } });
    expect((await sendInviteWelcome(fakeSupabase(), { email: "a@example.com" }, "org-1", { ...throwing.deps, awl })).status).toBe("send_failed");
  });

  test("no log line ever carries the token or the link", async () => {
    const all: string[] = [];
    for (const mint of [async () => minted(0), async () => { throw new AwlError(`bad ${LINK}`, 500, "X"); }]) {
      const { awl } = fakeAwl({ mint });
      const h = harness();
      await sendInviteWelcome(fakeSupabase(), { email: "a@example.com" }, "org-1", { ...h.deps, awl });
      all.push(...h.logs);
    }
    const sendFail = harness({ send: async () => ({ sent: false }) });
    await sendInviteWelcome(fakeSupabase(), { email: "a@example.com" }, "org-1", { ...sendFail.deps, awl: fakeAwl().awl });
    all.push(...sendFail.logs);
    expect(all.length).toBeGreaterThan(2);
    for (const l of all) {
      expect(l).not.toContain(TOKEN);
      expect(l).not.toContain("ai-work-link/");
      expect(l).not.toContain("a@example.com");
    }
  });
});

describe("freshSession: the mint refuses a session older than 15 minutes, so an old one is refreshed first", () => {
  const jwt = (iat: number) => `h.${Buffer.from(JSON.stringify({ iat })).toString("base64url")}.s`;
  function supa(token: string) {
    const calls: string[] = [];
    const s: WelcomeSupabase = {
      auth: {
        getSession: async () => { calls.push("get"); return { data: { session: { access_token: token } } }; },
        refreshSession: async () => { calls.push("refresh"); return { data: { session: { access_token: "refreshed" } } }; },
      },
      from: () => null,
    };
    return { s, calls };
  }

  test("a token issued 2 minutes ago is used as it is", async () => {
    const t = jwt(1_000_000 - 120);
    const { s, calls } = supa(t);
    expect(await freshSession(s, () => 1_000_000).accessToken()).toBe(t);
    expect(calls).toEqual(["get"]);
  });

  test("a token issued 20 minutes ago (or unreadable) is refreshed", async () => {
    for (const t of [jwt(1_000_000 - 1200), "not-a-jwt"]) {
      const { s, calls } = supa(t);
      expect(await freshSession(s, () => 1_000_000).accessToken()).toBe("refreshed");
      expect(calls).toEqual(["get", "refresh"]);
    }
  });
});
