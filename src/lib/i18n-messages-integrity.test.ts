/// <reference types="bun-types" />
// R81 -- the two ways a translation file lies without failing.
//
// WHY THIS EXISTS. `messages/en.json` and `messages/hi.json` each carried the
// key "designStudio" TWICE inside the same object, with identical values. JSON
// has no duplicate-key error: every parser silently keeps the last one and
// discards the first. So the file was wrong in a way that no build step, no
// type check and no test could see, and the only reason it was harmless is that
// the two values happened to agree. Had they differed, the file would have said
// one thing and the application would have done another, permanently, with
// nothing to point at.
//
// The second failure mode is the one that actually shipped today: a namespace
// present in the messages file but absent from where it needs to be listed
// renders every string as its RAW KEY in the browser -- and the unit tests for
// that page passed the whole time, because they assert on behaviour rather than
// on the text a human sees. Locale drift is the same shape: a key present in
// `en` and missing from `hi` renders the raw key to a Hindi user only, which is
// exactly the kind of defect nobody on the team is positioned to notice.
//
// Both checks are cheap, decidable from the files alone, and catch the fault on
// the commit that introduces it rather than in front of a user.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const MESSAGES_DIR = path.join(import.meta.dir, "..", "..", "messages");
const LOCALES = ["en", "hi"] as const;

function readRaw(locale: string): string {
  return readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8");
}

/** Collect duplicate keys at every depth, reported as a dotted path. */
function duplicateKeys(raw: string): string[] {
  const dupes: string[] = [];
  // A JSON.parse reviver cannot help here: by the time it runs, the duplicate
  // has already been discarded. So the raw text is scanned directly, tracking
  // object depth and recording which key names are declared at each path. A
  // string counts as a KEY only when the next non-space character is a colon,
  // which is what distinguishes it from a value that happens to look like one.
  // Escaped characters inside strings are skipped so a quote in a value cannot
  // desynchronise the scan.
  const path: string[] = [];
  const counts = new Map<string, Map<string, number>>();
  let i = 0;
  let pendingKey: string | null = null;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') {
      let j = i + 1;
      let out = "";
      while (j < raw.length && raw[j] !== '"') {
        if (raw[j] === "\\") { out += raw[j + 1]; j += 2; continue; }
        out += raw[j]; j += 1;
      }
      // a string is a KEY if the next non-space character is a colon
      let k = j + 1;
      while (k < raw.length && /\s/.test(raw[k])) k += 1;
      if (raw[k] === ":") {
        pendingKey = out;
        const scope = path.join(".") || "(root)";
        if (!counts.has(scope)) counts.set(scope, new Map());
        const m = counts.get(scope)!;
        m.set(out, (m.get(out) ?? 0) + 1);
      }
      i = j + 1;
      continue;
    }
    if (ch === "{") { path.push(pendingKey ?? "(root)"); pendingKey = null; }
    else if (ch === "}") { path.pop(); }
    i += 1;
  }
  for (const [scope, m] of counts) {
    for (const [k, n] of m) if (n > 1) dupes.push(`${scope === "(root)" ? "" : scope + "."}${k} (x${n})`);
  }
  return dupes;
}

function flatKeys(value: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(prefix + k);
      for (const nested of flatKeys(v, `${prefix}${k}.`)) out.add(nested);
    }
  }
  return out;
}

describe("translation files: the two ways they lie without failing", () => {
  for (const locale of LOCALES) {
    test(`${locale}.json declares no key twice`, () => {
      const raw = readRaw(locale);
      // Guard the guard: if the file moved or emptied, fail loudly rather than
      // pass over nothing -- a check that silently examines an empty set is the
      // failure mode this whole file exists to prevent.
      expect(raw.length, `messages/${locale}.json is empty or missing`).toBeGreaterThan(100);

      const dupes = duplicateKeys(raw);
      expect(
        dupes,
        `messages/${locale}.json declares these keys more than once in the same object: ${dupes.join(", ")}. ` +
          `JSON has no duplicate-key error -- every parser keeps the LAST and discards the rest -- so the file ` +
          `would say one thing while the application did another, with nothing to point at.`,
      ).toEqual([]);
    });
  }

  test("every locale declares exactly the same keys", () => {
    const [base, ...rest] = LOCALES;
    const baseKeys = flatKeys(JSON.parse(readRaw(base)));
    expect(baseKeys.size, "the base locale has suspiciously few keys").toBeGreaterThan(100);

    for (const locale of rest) {
      const other = flatKeys(JSON.parse(readRaw(locale)));
      const missing = [...baseKeys].filter((k) => !other.has(k)).sort();
      const extra = [...other].filter((k) => !baseKeys.has(k)).sort();

      // A key present in en and missing from hi renders the RAW KEY to a Hindi
      // user and to nobody else, which is why it survives review.
      expect(
        missing,
        `${missing.length} key(s) exist in ${base}.json but not ${locale}.json, so a ${locale} user sees the raw key: ${missing.slice(0, 10).join(", ")}`,
      ).toEqual([]);
      expect(
        extra,
        `${extra.length} key(s) exist in ${locale}.json but not ${base}.json -- either a stale translation or a missing source string: ${extra.slice(0, 10).join(", ")}`,
      ).toEqual([]);
    }
  });
});
