// Settings and team: inviting people, accepting an invitation, changing roles and the organisation currency.
// Server messages: PROJEXA api/org/invites (+ accept, preview), api/org-members, api/organization/currency, the accept_org_invite SQL function.
import { guides, here, loginBack } from "./_helpers";

const SBACK = "Back to Settings";

export const settingsGuides = guides([
  {
    id: "invite-email-invalid", source: "validation", match: { code: "INVITE_EMAIL_INVALID" },
    title: "That e-mail address is not complete",
    what: "{serverMessage}",
    why: "The invitation link is made for exactly one e-mail address, so the address has to be complete and correct.",
    steps: ["Click the e-mail box.", "Check for a missing @ sign, a missing ending such as .com, or a space.", "Press Invite again."],
    fix: { label: "Fix the e-mail", to: here, where: "This screen > Invite people > E-mail address" },
    severity: "warn", returnLabel: SBACK,
  },
  {
    id: "invite-revoked", source: "auth", match: { code: "INVITE_REVOKED" },
    title: "This invitation was cancelled",
    what: "{serverMessage}",
    why: "An administrator withdrew the invitation, so the link no longer lets anyone join.",
    steps: ["Ask the administrator of the organisation for a new invitation.", "Open the new link they send you."],
    fix: { label: "Go to sign in", to: "/login", where: "Sign in" },
    severity: "block", returnLabel: "Back to the invitation",
  },
  {
    id: "invite-wrong-email", source: "auth", match: { code: "INVITE_WRONG_EMAIL" },
    title: "Sign in with the invited e-mail",
    what: "{serverMessage}",
    why: "An invitation is tied to one e-mail address, so a forwarded link grants nothing to a different address.",
    steps: ["Sign out, or open the link in another browser.", "Sign in with the exact e-mail address the invitation was sent to.", "You come straight back to the invitation."],
    fix: { label: "Sign in with the right e-mail", to: loginBack, where: "Sign in, then straight back to the invitation" },
    severity: "block", returnLabel: "Back to the invitation",
  },
  {
    id: "clipboard-blocked", source: "unknown", match: { code: "CLIPBOARD_BLOCKED" },
    title: "The link could not be copied for you",
    what: "{serverMessage}",
    why: "Your browser did not allow this page to use the clipboard. The invitation itself is fine.",
    steps: ["Select the link shown above with your mouse and copy it yourself.", "Send it to the person it was made for."],
    severity: "info", returnLabel: SBACK,
  },
  {
    id: "settings-save-failed", source: "server", match: { status: [500, 502, 503], apiPath: "/api/organization" },
    title: "Your settings were not saved",
    what: "{serverMessage}",
    why: "The server could not store the change. Nothing was changed.",
    steps: ["Wait a few seconds.", "Press Try again."],
    fix: { label: "Reload Settings", to: here, where: "This screen" },
    retry: true, severity: "warn", returnLabel: SBACK,
  },
]);

