// Which guided-error code an invitation problem is (the words are in the catalogue, g4-session-laptop.ts). Pure: status + the server's message in, code out.
export type InviteCode = "INVITE_NOT_VALID" | "INVITE_CLOSED" | "INVITE_WRONG_EMAIL" | "INVITE_SIGNED_OUT" | "INVITE_OFFLINE" | "INVITE_FAILED";

export function inviteFailureCode(input: { status?: number; message?: string; offline?: boolean }): InviteCode {
  if (input.offline) return "INVITE_OFFLINE";
  const m = input.message ?? "";
  if (input.status === 401 || /must be signed in/i.test(m)) return "INVITE_SIGNED_OUT";
  if (/different e-?mail|another e-?mail|sent to .*@|does not match|not (for|addressed to) (you|this)/i.test(m)) return "INVITE_WRONG_EMAIL";
  if (/expired|already (been )?(used|accepted)|revoked|no longer (open|valid)|used up/i.test(m)) return "INVITE_CLOSED";
  if (input.status === 404 || /not valid|not found|invalid/i.test(m)) return "INVITE_NOT_VALID";
  return "INVITE_FAILED";
}
