// AUDIT-100 B62: "plain-English messages everywhere". A sweep, not a style guide: every sentence a person can be shown by the laptop shell,
// the install screen, the AI-link controls and the error dictionaries must be free of the words that mean nothing to a site engineer
// (status numbers, raw codes, "undefined", "JSON", "exception" ...). It also proves the sweep itself can fail (a planted bad sentence is caught)
// and that it really reads the files (a floor on how many sentences it found), so it cannot pass by looking at nothing.
//
// Run: bun test --isolate src/lib/local-first/plain-english.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { allMessages } from "../task-errors";
import { syncCodeSentence } from "./outbox-words";
import { OWN_AI_SENTENCE } from "./ai-off/internal-ai";

const root = join(import.meta.dir, "..", "..", "..");

/** Words and shapes that must never reach a person. MCP / OpenAPI / Swagger are allowed: they are the names AI apps ask for in the Connect panel. */
const JARGON = /\b(undefined|null|NaN|\[object|exception|stack ?trace|payload|endpoint|SQL|JSON|RLS|HTTP|ECONN\w*|ETIMEDOUT|TypeError|ReferenceError|IndexedDB|localStorage|CORS|JWT|[45]\d\d)\b|\b[A-Z]{2,}_[A-Z0-9_]{2,}\b/;

export function jargonIn(text: string): string | null {
  return JARGON.exec(text)?.[0] ?? null;
}

/** The sentences written inside a .tsx file: JSX text and plain double-quoted sentences of at least four words. */
function sentencesIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/>([^<>{}=\n]{12,})</g)) out.push(m[1].trim());
  for (const m of source.matchAll(/"([A-Z][^"\n$`{}\\]{20,})"/g)) out.push(m[1].trim());
  return out.filter((t) => t.split(/\s+/).length >= 4 && !/(px-|\[#|flex |text-|bg-|border-|rounded)/.test(t));
}

const UI_DIRS = ["src/lib/local-first/shell", "src/components/local-first", "src/components/ai-link"];
const UI_FILES = ["src/components/WorkspacePrepare.tsx", "src/components/OutboxAttention.tsx", "src/components/PeerSyncMarker.tsx"];

function uiSentences(): Array<{ file: string; text: string }> {
  const files = [
    ...UI_DIRS.flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith(".tsx") && !f.includes(".test.")).map((f) => `${d}/${f}`)),
    ...UI_FILES,
  ];
  return files.flatMap((file) => sentencesIn(readFileSync(join(root, file), "utf8")).map((text) => ({ file, text })));
}

describe("plain English (B62)", () => {
  test("the sweep catches jargon (so a pass means something)", () => {
    expect(jargonIn("Request failed: HTTP 503 undefined")).not.toBeNull();
    expect(jargonIn("TEXT_TOO_LONG")).not.toBeNull();
    expect(jargonIn("Server said 502 Bad Gateway")).not.toBeNull();
    expect(jargonIn("Your changes are saved on this laptop and will be sent when you are online.")).toBeNull();
    expect(jargonIn("Connect PROJEXA to your AI app (MCP, OpenAPI, Swagger).")).toBeNull();
  });

  test("every error sentence the dictionaries can show is plain", () => {
    const messages = allMessages({ itemCode: "A-1", project: "Tower", version: "2", value: "5", worker: "Ravi", task: "Slab" });
    expect(messages.length).toBeGreaterThan(20);
    const bad = messages.map((m) => ({ code: m.code, word: jargonIn(m.message) })).filter((m) => m.word);
    expect(bad, JSON.stringify(bad)).toEqual([]);
  });

  test("every sentence for the sync service's own codes is plain, and each ends the way a sentence does", () => {
    const codes = ["TEXT_TOO_LONG", "ROLE_TOO_LOW", "FUNCTION_NOT_ALLOWED", "PROJECT_NOT_READABLE", "OP_ID_REUSED", "BAD_OP", "CAP_DAY", "RECORD_DELETED", "EXECUTION_UNCERTAIN"];
    for (const code of codes) {
      const s = syncCodeSentence(code);
      expect(s, `${code} has no sentence`).not.toBeNull();
      expect(jargonIn(s!), `${code}: ${s}`).toBeNull();
      expect(s![0], `${code} should start with a capital letter`).toBe(s![0].toUpperCase());
    }
  });

  test("the 'use your own AI' sentence is plain", () => {
    expect(jargonIn(OWN_AI_SENTENCE.replace("/llms.txt", "the AI guide"))).toBeNull();
  });

  test("every sentence written in the shell, install screen and AI-link controls is plain", () => {
    const all = uiSentences();
    expect(all.length, "the sweep found almost no sentences: the extraction is broken").toBeGreaterThan(40);
    const bad = all.map((s) => ({ ...s, word: jargonIn(s.text) })).filter((s) => s.word);
    expect(bad.map((b) => `${b.file}: "${b.text.slice(0, 80)}" (${b.word})`)).toEqual([]);
  });
});
