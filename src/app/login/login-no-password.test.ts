/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// P1 guard: the sign-in has NO password and no chosen passcode. Fails if either comes back into src/app/login, signup or forgot-password,
// and checks the wiring the page must keep (e-mailed code, the 6-digit code box, one door for signup and forgot).
const APP = join(import.meta.dir, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const sources = ["login", "signup", "forgot-password"].flatMap((d) => files(join(APP, d))).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

describe("P1 sign-in has no password", () => {
  test("no password field, signInWithPassword, signUp(password) or passcode logic in the sign-in pages", () => {
    for (const f of sources) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toContain("signInWithPassword");
      expect(s, f).not.toMatch(/type=["']password["']/);
      expect(s, f).not.toMatch(/offline-pin|OfflinePasscode|unlockOffline|rememberPinAfterOnlineLogin/);
      expect(s, f).not.toContain("resetPasswordForEmail");
    }
  });

  test("the retired passcode modules are gone", () => {
    expect(existsSync(join(APP, "..", "lib", "local-first", "offline-pin.ts"))).toBe(false);
    expect(existsSync(join(APP, "..", "lib", "local-first", "shell", "OfflinePasscodeSignIn.tsx"))).toBe(false);
  });

  test("the login page uses the e-mailed code flow with a numeric one-time-code box", () => {
    const s = readFileSync(join(APP, "login", "page.tsx"), "utf8");
    expect(s).toContain("createEmailCodeLogin");
    expect(s).toContain('inputMode="numeric"');
    expect(s).toContain('autoComplete="one-time-code"');
    expect(s).toContain("CODE_LENGTH");
  });

  test("signup and forgot-password are redirects to the one door", () => {
    for (const d of ["signup", "forgot-password"]) {
      const s = readFileSync(join(APP, d, "page.tsx"), "utf8");
      expect(s).toContain('redirect("/login")');
    }
  });
});
