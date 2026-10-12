import { describe, expect, test } from "bun:test";
import { PROJECT_COOKIE, readCookieProjectId } from "./project-cookie";

describe("readCookieProjectId", () => {
  test("reads the project cookie out of a cookie string", () => {
    expect(readCookieProjectId(`a=1; ${PROJECT_COOKIE}=abc-123; b=2`)).toBe("abc-123");
  });
  test("decodes the value", () => {
    expect(readCookieProjectId(`${PROJECT_COOKIE}=a%20b`)).toBe("a b");
  });
  test("null when absent, blank or unreadable", () => {
    expect(readCookieProjectId("a=1; b=2")).toBeNull();
    expect(readCookieProjectId(`${PROJECT_COOKIE}=`)).toBeNull();
    expect(readCookieProjectId(`${PROJECT_COOKIE}=%E0%A4%A`)).toBeNull();
    expect(readCookieProjectId("")).toBeNull();
  });
});
