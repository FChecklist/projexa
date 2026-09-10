// P2.3 (W-ENV, R81-ADDENDUM-B phase S5): proves the destructive-test guard
// actually refuses a non-local, non-test connection string. Pure function
// test -- no real DB connection is opened here, so this needs no DATABASE_URL
// and is safe under bun test --isolate.
import { describe, test, expect } from "bun:test";
import { assertTestDatabase } from "./test-guard";

describe("assertTestDatabase (P2.3 destructive-test guard)", () => {
  test("does not throw for this repo's known dev/test project", () => {
    expect(() =>
      assertTestDatabase("postgresql://postgres.evpckeuxgvahguwsaeul:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres")
    ).not.toThrow();
  });

  test("does not throw for a plain local Postgres URL", () => {
    expect(() => assertTestDatabase("postgresql://postgres:pw@localhost:5432/postgres")).not.toThrow();
    expect(() => assertTestDatabase("postgresql://postgres:pw@127.0.0.1:5432/postgres")).not.toThrow();
  });

  test("does not throw when DATABASE_URL is unset (nothing to connect to, nothing to guard)", () => {
    expect(() => assertTestDatabase(undefined)).not.toThrow();
  });

  test("throws for a connection string pointing at an unrecognised host/project", () => {
    expect(() => assertTestDatabase("postgresql://postgres:pw@some-other-prod-host.example.com:5432/postgres")).toThrow(
      /DESTRUCTIVE-TEST GUARD/
    );
  });

  test("throws for a malformed connection string", () => {
    expect(() => assertTestDatabase("not-a-url")).toThrow(/DESTRUCTIVE-TEST GUARD/);
  });
});
