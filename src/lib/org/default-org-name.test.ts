/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { defaultOrgName, FALLBACK_ORG_NAME } from "./default-org-name";

describe("defaultOrgName", () => {
  test("a work address names the company", () => {
    expect(defaultOrgName("asha@lakeview-builders.co.in")).toBe("Lakeview Builders");
    expect(defaultOrgName("raj@acme.com")).toBe("Acme");
    expect(defaultOrgName("x@mail.shobha.in")).toBe("Shobha");
  });
  test("a personal-mail address, a missing e-mail or junk gets 'My Company'", () => {
    expect(defaultOrgName("sumeetds@gmail.com")).toBe(FALLBACK_ORG_NAME);
    expect(defaultOrgName("a@Outlook.com")).toBe("My Company");
    expect(defaultOrgName(null)).toBe("My Company");
    expect(defaultOrgName("no-at-sign")).toBe("My Company");
    expect(defaultOrgName("a@localhost")).toBe("My Company");
  });
});
