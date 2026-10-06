// AUDIT-100 G-09: the golden scenarios of the PARITY CONTRACT between PROJEXA's Next routes /api/org/provision + /api/org/repair and the Supabase
// Edge Function `projexa-api` (compliance-tracker supabase/functions/projexa-api/org-provision.ts). A scenario names WHO calls and what the WORLD
// does at each step; src/lib/org-provision-parity.test.ts runs it through the REAL Next pipeline (middleware + route + requireAuth + veridian-client)
// and records the answer plus the observable effects (ai-os/audit37/projexa-api/org-parity.golden.json); compliance-tracker replays the same
// scenarios through the edge handler and must produce the same status, body and effects.
import { IDENTITIES, ORG_A, type Who } from "./projexa-api-parity-cases";

export type World = {
  /** the organisation already has a credentials row (default false) */
  credentials?: boolean;
  /** VERIDIAN provisioning: ok (default) or the platform endpoint answers this HTTP status with this error text */
  veridian?: "ok" | { status: number; error: string };
  /** step 2 of provision: PROJEXA organizations insert / memberships insert */
  org_insert?: "ok" | "error";
  membership_insert?: "ok" | "error";
  /** the credentials insert: ok, throws, or "silent_noop" (the insert is accepted and nothing is readable afterwards) */
  store?: "ok" | "error" | "silent_noop";
  /** repair: the organizations row read */
  org_read?: "ok" | "missing" | "error";
  org_country?: string | null;
};
export type OrgCase = { name: string; method: "GET" | "POST"; path: "/api/org/provision" | "/api/org/repair"; body?: unknown; raw_body?: string; who: Who; world?: World };
export type OrgEffects = {
  /** what reached VERIDIAN's provisioning, in order: { name, country } */
  veridian_provisioned: { name: string; country: string | null }[];
  /** PROJEXA organizations rows inserted: { name, slug_prefix } */
  orgs_inserted: { name: string; slug_prefix: string }[];
  memberships_inserted: { user_id: string; role: string; organization_is_new: boolean }[];
  /** credentials stored: for which PROJEXA organisation ("new" or the caller's), with which VERIDIAN org */
  credentials_stored: { organization: "new" | "existing"; veridian_org_id: string }[];
};
export type OrgOutcome = { status: number; body: unknown; effects: OrgEffects };

const P = "/api/org/provision" as const;
const R = "/api/org/repair" as const;
export const VERIDIAN_NEW_ORG = "veridian-org-new";

export function orgCases(): OrgCase[] {
  const list: OrgCase[] = [];
  const add = (c: OrgCase) => list.push(c);
  // provision
  add({ name: "provision: signed out", method: "POST", path: P, body: { orgName: "Acme" }, who: "signed_out" });
  add({ name: "provision: signed out, no body", method: "POST", path: P, who: "signed_out" });
  add({ name: "provision: no body", method: "POST", path: P, who: "no_org" });
  add({ name: "provision: broken body", method: "POST", path: P, raw_body: "{nope", who: "no_org" });
  add({ name: "provision: empty orgName", method: "POST", path: P, body: { orgName: "   " }, who: "no_org" });
  add({ name: "provision: orgName not a string", method: "POST", path: P, body: { orgName: 7 }, who: "no_org" });
  add({ name: "provision: new organisation", method: "POST", path: P, body: { orgName: "  Acme Builders Pvt. Ltd.  " }, who: "no_org" });
  add({ name: "provision: client_viewer already has a membership", method: "POST", path: P, body: { orgName: "Gulf Fitout" }, who: "client_viewer" , world: { credentials: false } });
  add({ name: "provision: already provisioned and connected", method: "POST", path: P, body: { orgName: "Acme" }, who: "owner", world: { credentials: true } });
  add({ name: "provision: already provisioned, credentials missing (repair required)", method: "POST", path: P, body: { orgName: "Acme" }, who: "owner", world: { credentials: false } });
  add({ name: "provision: a member of any role is told the same", method: "POST", path: P, body: { orgName: "Acme" }, who: "site_engineer", world: { credentials: true } });
  add({ name: "provision: VERIDIAN answers 500", method: "POST", path: P, body: { orgName: "Acme" }, who: "no_org", world: { veridian: { status: 500, error: "Failed to provision organisation" } } });
  add({ name: "provision: VERIDIAN answers 400", method: "POST", path: P, body: { orgName: "Acme" }, who: "no_org", world: { veridian: { status: 400, error: "customerOrgName is required" } } });
  add({ name: "provision: PROJEXA organizations insert fails", method: "POST", path: P, body: { orgName: "Acme" }, who: "no_org", world: { org_insert: "error" } });
  add({ name: "provision: PROJEXA memberships insert fails", method: "POST", path: P, body: { orgName: "Acme" }, who: "no_org", world: { membership_insert: "error" } });
  add({ name: "provision: storing the credentials fails", method: "POST", path: P, body: { orgName: "Acme" }, who: "no_org", world: { store: "error" } });
  add({ name: "provision: a failed membership read is not 'no membership'", method: "POST", path: P, body: { orgName: "Acme" }, who: "membership_error" });
  // repair, read
  add({ name: "repair GET: signed out", method: "GET", path: R, who: "signed_out" });
  add({ name: "repair GET: no organisation", method: "GET", path: R, who: "no_org" });
  add({ name: "repair GET: member", method: "GET", path: R, who: "member", world: { credentials: false } });
  add({ name: "repair GET: pm", method: "GET", path: R, who: "pm", world: { credentials: false } });
  add({ name: "repair GET: null role", method: "GET", path: R, who: "null_role", world: { credentials: false } });
  add({ name: "repair GET: owner, connected", method: "GET", path: R, who: "owner", world: { credentials: true } });
  add({ name: "repair GET: admin, not connected", method: "GET", path: R, who: "admin", world: { credentials: false } });
  // repair, write
  add({ name: "repair POST: signed out", method: "POST", path: R, who: "signed_out" });
  add({ name: "repair POST: no organisation", method: "POST", path: R, who: "no_org" });
  for (const w of ["pm", "site_engineer", "member", "client_viewer"] as const) add({ name: `repair POST: ${w}`, method: "POST", path: R, who: w, world: { credentials: false } });
  add({ name: "repair POST: null role", method: "POST", path: R, who: "null_role", world: { credentials: false } });
  add({ name: "repair POST: owner, already healthy", method: "POST", path: R, who: "owner", world: { credentials: true } });
  add({ name: "repair POST: admin repairs a broken workspace", method: "POST", path: R, who: "admin", world: { credentials: false, org_country: "AE" } });
  add({ name: "repair POST: owner repairs, organisation has no country", method: "POST", path: R, who: "owner", world: { credentials: false, org_country: null } });
  add({ name: "repair POST: the organisation row is gone", method: "POST", path: R, who: "owner", world: { credentials: false, org_read: "missing" } });
  add({ name: "repair POST: the organisation read fails", method: "POST", path: R, who: "owner", world: { credentials: false, org_read: "error" } });
  add({ name: "repair POST: VERIDIAN answers 500", method: "POST", path: R, who: "owner", world: { credentials: false, veridian: { status: 500, error: "Failed to provision organisation" } } });
  add({ name: "repair POST: storing fails", method: "POST", path: R, who: "owner", world: { credentials: false, store: "error" } });
  add({ name: "repair POST: stored but not readable back", method: "POST", path: R, who: "owner", world: { credentials: false, store: "silent_noop" } });
  return list;
}

export { IDENTITIES, ORG_A };
