/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { safeRedirectPath } from "./safe-redirect";

// AUDIT-100 B6/B56: the sign-in page honours ?redirectTo so an invited person comes back to /invite/<token>, and never becomes an open redirect.
describe("safeRedirectPath", () => {
  test("an invitation path comes back unchanged", () => {
    expect(safeRedirectPath("/invite/abc123")).toBe("/invite/abc123");
  });

  test("a signed-in page with a query comes back unchanged", () => {
    expect(safeRedirectPath("/projects?tab=open")).toBe("/projects?tab=open");
  });

  test("missing or empty falls back to the dashboard", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
  });

  test("another origin is refused", () => {
    expect(safeRedirectPath("https://evil.example/x")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example/x")).toBe("/dashboard");
    expect(safeRedirectPath("/\\evil.example/x")).toBe("/dashboard");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeRedirectPath("/ok\n//evil")).toBe("/dashboard");
  });

  test("the sign-in and sign-up forms never loop back onto themselves", () => {
    expect(safeRedirectPath("/login")).toBe("/dashboard");
    expect(safeRedirectPath("/login?redirectTo=/x")).toBe("/dashboard");
    expect(safeRedirectPath("/signup")).toBe("/dashboard");
  });

  test("a custom fallback is used when the target is refused", () => {
    expect(safeRedirectPath("//evil", "/home")).toBe("/home");
  });
});
