import { describe, test, expect } from "bun:test";
import { visibleWorkspaceSections, canSeeWorkspaceSection, WORKSPACE_SECTIONS } from "./workspace-visibility";

describe("visibleWorkspaceSections", () => {
  test("owner/admin/pm see every section", () => {
    for (const role of ["owner", "admin", "pm"]) {
      expect(visibleWorkspaceSections(role).length).toBe(WORKSPACE_SECTIONS.length);
      for (const section of WORKSPACE_SECTIONS) {
        expect(canSeeWorkspaceSection(role, section.key)).toBe(true);
      }
    }
  });

  test("site_engineer sees field/schedule surfaces only, never BOQ/Scope/Billing/Insights", () => {
    const sections = visibleWorkspaceSections("site_engineer");
    expect(sections).toContain("progress");
    expect(sections).toContain("site-diary");
    expect(sections).toContain("timeline");
    expect(sections).toContain("milestones");
    expect(sections).toContain("rfis");
    expect(sections).toContain("resources");
    expect(sections).toContain("records");
    expect(sections).not.toContain("boq");
    expect(sections).not.toContain("scope-change-orders");
    expect(sections).not.toContain("billing-milestones");
    expect(sections).not.toContain("insights");
  });

  test("member (acting as Finance) sees commercial/schedule surfaces, never field-recording or records/resources", () => {
    const sections = visibleWorkspaceSections("member");
    expect(sections).toEqual(["boq", "timeline", "milestones", "scope-change-orders", "billing-milestones", "insights"]);
    expect(sections).not.toContain("progress");
    expect(sections).not.toContain("site-diary");
    expect(sections).not.toContain("rfis");
    expect(sections).not.toContain("resources");
    expect(sections).not.toContain("records");
  });

  test("client_viewer sees exactly member's set minus Insights", () => {
    const clientSections = visibleWorkspaceSections("client_viewer");
    const memberSections = visibleWorkspaceSections("member");
    expect(clientSections).toEqual(memberSections.filter((s) => s !== "insights"));
    expect(clientSections).not.toContain("resources");
    expect(clientSections).not.toContain("records");
    expect(clientSections).not.toContain("site-diary");
    expect(clientSections).not.toContain("rfis");
  });

  test("a null or unknown role sees nothing -- fail-closed, matching requireRole()'s own default", () => {
    expect(visibleWorkspaceSections(null)).toEqual([]);
    expect(visibleWorkspaceSections("some-future-role-not-yet-known")).toEqual([]);
  });
});
