/// <reference types="bun-types" />
// Issuing more than is in stock: when the stock figure had not loaded yet the form cannot refuse it itself and the SERVER's 400 ("Only 10 bags on hand.")
// reached the person as the generic "Please correct the entry". It must be the stock guide either way. Found by the live guided-errors run 2026-10-22 (M6).
import { describe, expect, test } from "bun:test";
import { matchGuide } from "../match";

describe("issue more than is in stock", () => {
  const server = { status: 400, serverMessage: "Only 10 bags on hand", apiPath: "/api/materials/issues", method: "POST", route: "/materials/issues/new", search: "" };
  test("the server's own refusal gets the stock guide", () => {
    expect(matchGuide(server as never).id).toMatch(/^materials-issue-more-than-stock/);
  });
  test("the form's own refusal still gets the stock guide", () => {
    expect(matchGuide({ code: "ISSUE_EXCEEDS_STOCK", field: "quantity", serverMessage: "Only 10 bags on hand, so 50 cannot be issued.", route: "/materials/issues/new", search: "" } as never).id).toBe("materials-issue-more-than-stock");
  });
});
