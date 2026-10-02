import { describe, expect, test } from "bun:test";
import { canonicalJson, sha256Hex } from "./canonical";
// The build script has its own copy (a Node script cannot import TypeScript). Both must agree to the byte.
import { canonicalJson as scriptCanonicalJson, sha256Hex as scriptSha256Hex } from "../../../../scripts/make-release.mjs";

// The fixed vector of docs/local-first/CONTRACT.md section 1. The backend asserts the same text and digest, so a laptop and
// the server can never disagree about what a manifest hashes to.
const VECTOR_INPUT = { b: [1, 2.5, "x"], a: { z: null, y: 'é\n"', x: -0.5 }, c: true };
const VECTOR_CANONICAL = '{"a":{"x":-0.5,"y":"é\\n\\"","z":null},"b":[1,2.5,"x"],"c":true}';
const VECTOR_SHA256 = "bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565";

describe("canonical JSON: the contract's fixed vector", () => {
  test("the canonical text is exactly the contract's", () => {
    expect(canonicalJson(VECTOR_INPUT)).toBe(VECTOR_CANONICAL);
  });

  test("its sha256 is exactly the contract's", async () => {
    expect(await sha256Hex(canonicalJson(VECTOR_INPUT))).toBe(VECTOR_SHA256);
  });

  test("the build script's copy produces the same text and the same digest", () => {
    expect(scriptCanonicalJson(VECTOR_INPUT)).toBe(VECTOR_CANONICAL);
    expect(scriptSha256Hex(VECTOR_CANONICAL)).toBe(VECTOR_SHA256);
  });
});

describe("canonical JSON: rules beyond the vector", () => {
  test("keys are sorted at every level, array order is kept", () => {
    expect(canonicalJson({ z: [{ b: 1, a: 2 }, 3], a: {} })).toBe('{"a":{},"z":[{"a":2,"b":1},3]}');
  });

  test("undefined members are dropped; an undefined array slot is null", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([1, undefined, 2])).toBe("[1,null,2]");
  });

  test("the script and the app agree on varied input", () => {
    const samples: unknown[] = [
      null, 0, "text", [], {}, { k: "v" },
      { release_version: "2026.10.02-007", files: [{ sha256: "ab", path: "a", size: 1 }], protocol: 2, nested: { y: [1, { b: 2, a: 1 }], x: null } },
      { "é": 1, e: 2, "Z": 3, "a b": 4 },
    ];
    for (const sample of samples) expect(scriptCanonicalJson(sample)).toBe(canonicalJson(sample));
  });

  test("sha256Hex hashes bytes and text alike", async () => {
    // The well-known digest of "abc".
    const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await sha256Hex("abc")).toBe(abc);
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(abc);
    expect(await sha256Hex(new TextEncoder().encode("xabcx").subarray(1, 4))).toBe(abc); // a view into a larger buffer
  });
});
