/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-08 (AW-405). Who is shown the AI work link buttons: every real role except the read-only client_viewer, and nobody
// whose role is not known.
import { describe, expect, test } from "bun:test";
import { AI_WORK_LINK_ROLE_NOTE, canMakeAiWorkLink } from "./ai-work-link-access";
import { ALL_ORG_ROLES } from "@/lib/authz/roles";

describe("canMakeAiWorkLink", () => {
  test("the member line: owner, admin, pm, site_engineer and member may; client_viewer may not", () => {
    const answers = Object.fromEntries(ALL_ORG_ROLES.map((r) => [r, canMakeAiWorkLink(r)]));
    expect(answers).toEqual({ owner: true, admin: true, pm: true, site_engineer: true, member: true, client_viewer: false });
  });

  test("an unknown, empty or missing role may not", () => {
    for (const role of [null, undefined, "", "superuser", "Owner"]) expect(canMakeAiWorkLink(role)).toBe(false);
  });

  test("the sentence a lower role reads says what is needed", () => {
    expect(AI_WORK_LINK_ROLE_NOTE).toContain("member role or above");
  });
});
