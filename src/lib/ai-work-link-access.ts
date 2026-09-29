// PROJEXA-BUILD-002 WP-08 (AW-405). Who is shown the AI work link buttons.
//
// The database decides who may make a link, from the person's VERIDIAN role rank: level 1 and project creation need rank 2 (member) or
// above, and it refuses anyone else with a coded answer. PROJEXA's own role is a set, not a rank (see src/lib/authz/roles.ts), so this is
// the closest match on this side: every role except the read-only client_viewer, which is ROLE_GROUPS.ANY_MEMBER, the group the app
// already uses for "a person doing real work in the organisation". It is a courtesy only, like useOrgRole: it hides a button the
// database would refuse, and the database stays the gate.
import { ROLE_GROUPS } from "@/lib/authz/roles"

const MAY_MAKE_LINKS: ReadonlySet<string> = new Set(ROLE_GROUPS.ANY_MEMBER)

/** True for a known role that may make an AI work link. An unknown or missing role is false. */
export function canMakeAiWorkLink(role: string | null | undefined): boolean {
  return typeof role === "string" && MAY_MAKE_LINKS.has(role)
}

/** The sentence a role below that line reads in place of the buttons. */
export const AI_WORK_LINK_ROLE_NOTE = "Making an AI work link needs the member role or above. Ask a project member or an admin to make one."

/** WO ai-work-link-ui-and-projects-tab (2026-09-29). The exact assistant list this feature names everywhere it talks about "any AI
 *  you use" -- AiWorkLinkCompact.tsx's one-click confirmation and AiWorkLinkDialog.tsx's own ResultPanel instruction sentence both
 *  read this one constant, so the two sentences cannot drift apart from each other as either file is edited later. Lives here
 *  (rather than in either of those two components) so neither has to import the other just for this string. Order and punctuation
 *  match the product owner's own wording verbatim. */
export const AI_ASSISTANT_NAMES = "ChatGPT, Gemini, Claude, Grok, DeepSeek, Z.ai"
