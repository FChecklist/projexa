// R67 D-19. The MoM action-item form used to ask a site engineer to paste a
// VERIDIAN user id into a text box, with an on-screen apology admitting there
// was no directory ("No org directory/picker yet -- paste a known VERIDIAN
// user ID."). There is a directory; it just had no PROJEXA-facing route until
// this item added GET /api/org-users.
//
// The display rules live here, pure, so they can be unit tested -- the
// component around them is a combobox whose typing this repo's bun +
// happy-dom + React 19 harness cannot drive (see mom-form.ts's header for the
// verified detail).

export type OrgUser = { id: string; name: string | null; email: string; role: string };

/** Two letters at most, from the name where there is one, else the email. */
export function initialsOf(user: Pick<OrgUser, "name" | "email">): string {
  const source = (user.name ?? "").trim() || user.email.split("@")[0].replace(/[._-]+/g, " ");
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** What the row shows: the person, not an opaque id. */
export function displayNameOf(user: Pick<OrgUser, "name" | "email">): string {
  return (user.name ?? "").trim() || user.email;
}

/**
 * Role as a person reads it. Unknown values are humanised rather than hidden,
 * so a role added in VERIDIAN tomorrow still renders as words.
 */
export function roleLabelOf(role: string): string {
  const known: Record<string, string> = {
    owner: "Owner", admin: "Admin", pm: "Project Manager", manager: "Manager",
    site_engineer: "Site Engineer", member: "Member", viewer: "Viewer", client_viewer: "Client",
  };
  return known[role] ?? role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type OrgUserGroups = { inMeeting: OrgUser[]; others: OrgUser[] };

/**
 * The meeting's own attendees come first -- an action item almost always
 * lands on somebody who was in the room. Attendees are free text (names typed
 * on the create form), so the match is on display name or email,
 * case-insensitively; anyone who cannot be matched to a real user simply does
 * not appear, because an action item needs a real assignee id.
 */
export function groupOrgUsers(users: readonly OrgUser[], attendees: readonly string[]): OrgUserGroups {
  const wanted = new Set(attendees.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const inMeeting: OrgUser[] = [];
  const others: OrgUser[] = [];
  for (const user of users) {
    const isAttendee =
      wanted.has(displayNameOf(user).toLowerCase()) || wanted.has(user.email.toLowerCase());
    (isAttendee ? inMeeting : others).push(user);
  }
  return { inMeeting, others };
}

export const CHOOSE_ASSIGNEE_REASON = "Choose an assignee";
export const ACTION_ITEM_VALIDATION_MESSAGE = "Choose an assignee and give the action a title";

/**
 * Why Add is disabled, or undefined when it is not. Title-first because that
 * is the field the eye lands on, and the combined sentence is what the footer
 * band shows when someone presses anyway.
 */
export function addActionItemDisabledReason(input: { title: string; assigneeId: string; busy?: boolean }): string | undefined {
  if (input.busy) return "Adding…";
  if (!input.assigneeId) return CHOOSE_ASSIGNEE_REASON;
  if (!input.title.trim()) return "Give the action a title";
  return undefined;
}
