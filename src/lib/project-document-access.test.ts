/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10. Who is shown the send-a-file controls and who is shown Approve.
import { describe, expect, test } from "bun:test";
import { canApproveProposal, canSendProjectDocument } from "./project-document-access";

describe("canSendProjectDocument", () => {
  test("every role except the read-only client_viewer", () => {
    for (const role of ["owner", "admin", "pm", "site_engineer", "member"]) expect(canSendProjectDocument(role)).toBe(true);
    expect(canSendProjectDocument("client_viewer")).toBe(false);
  });

  test("an unknown or missing role is not offered the control", () => {
    for (const role of [null, undefined, "", "superuser"]) expect(canSendProjectDocument(role)).toBe(false);
  });
});

describe("canApproveProposal", () => {
  test("owner, admin and pm approve: a proposal writes BOQ lines, which is money", () => {
    for (const role of ["owner", "admin", "pm"]) expect(canApproveProposal(role)).toBe(true);
  });

  test("site_engineer, member and client_viewer read it and do not approve it", () => {
    for (const role of ["site_engineer", "member", "client_viewer"]) expect(canApproveProposal(role)).toBe(false);
  });

  test("an unknown or missing role does not approve", () => {
    for (const role of [null, undefined, "", "superuser"]) expect(canApproveProposal(role)).toBe(false);
  });
});
