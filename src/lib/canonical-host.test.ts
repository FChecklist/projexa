/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { canonicalHostRedirect } from "./canonical-host";

describe("canonicalHostRedirect", () => {
  test("www goes to the apex, path and query kept", () => {
    expect(canonicalHostRedirect(new URL("https://www.projexa-ai.com/dashboard?x=1"))?.href).toBe("https://projexa-ai.com/dashboard?x=1");
  });
  test("the apex, previews and localhost are left alone", () => {
    expect(canonicalHostRedirect(new URL("https://projexa-ai.com/"))).toBeNull();
    expect(canonicalHostRedirect(new URL("https://projexa-smoky.vercel.app/"))).toBeNull();
    expect(canonicalHostRedirect(new URL("http://localhost:3100/"))).toBeNull();
  });
});
