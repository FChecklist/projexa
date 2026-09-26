// PROJEXA-BUILD-002 WP-10. Who is shown the "make a project from a file" screen and the chat attach control, and who is shown Approve on a
// prepared proposal.
//
// Sending a file uses the rule of the AI work link buttons (ai-work-link-access.ts): every role except the read-only client_viewer. VERIDIAN
// decides for real (its from-document route needs the member role and a named acting person), and the proxy of this app applies
// API_WRITE_POLICY; the check here only keeps a button from being offered that the server would refuse.
//
// Approving a prepared proposal writes BOQ line items, which is money, so it follows /scope/[id]/approve and the other commercial writes of
// this app: owner, admin or pm (ROLE_GROUPS.PM_OR_ABOVE). Listing the proposals is open to the same roles as sending a file.
import { ROLE_GROUPS } from "@/lib/authz/roles"
import { canMakeAiWorkLink } from "@/lib/ai-work-link-access"

const MAY_APPROVE: ReadonlySet<string> = new Set(ROLE_GROUPS.PM_OR_ABOVE)

/** True for a known role that may send a file to be made into a project. An unknown or missing role is false. */
export function canSendProjectDocument(role: string | null | undefined): boolean {
  return canMakeAiWorkLink(role)
}

/** True for a known role that may approve a prepared proposal. An unknown or missing role is false. */
export function canApproveProposal(role: string | null | undefined): boolean {
  return typeof role === "string" && MAY_APPROVE.has(role)
}

export const SEND_DOCUMENT_ROLE_NOTE = "Making a project from a file needs the member role or above. Ask a project member or an admin to send it."
export const APPROVE_ROLE_NOTE = "Approving a proposal needs the project manager role or above. You can read it here and ask a manager to approve it."
