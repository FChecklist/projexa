// A short, stable fingerprint: the same problem gives the same fingerprint on every device and every day, so the server can group
// "47 times, 12 people" into one issue. Built from kind + message with numbers/ids stripped + the screen pattern + the first stack function.
// Line numbers are deliberately NOT part of it (they change with every release).

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX = /\b[0-9a-f]{8,}\b/gi;
const NUMBER = /\b\d+(?:[.,]\d+)*\b/g;

export function normaliseMessage(message: string): string {
  return (message || "")
    .replace(UUID, "<id>")
    .replace(LONG_HEX, "<id>")
    .replace(NUMBER, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** /projects/3f2a.../budgets/12 -> /projects/:id/budgets/:id */
export function routePattern(route: string): string {
  const path = (route || "/").split("?")[0]!.split("#")[0]!;
  const isId = (seg: string) =>
    /^[0-9]+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(seg) || /^[0-9a-f]{12,}$/i.test(seg) || (seg.length >= 20 && /\d/.test(seg));
  return path.split("/").map((seg) => (isId(seg) ? ":id" : seg)).join("/") || "/";
}

/** The function name on the first real stack line (chrome "at fn (url:1:2)", firefox/safari "fn@url:1:2"); "anon" if none. */
export function firstFrameFunction(stack: string | null | undefined): string {
  if (!stack) return "none";
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    let m = /^at\s+(?:async\s+)?([^\s(]+)\s*\(/.exec(line);
    if (m) return m[1]!.replace(/^Object\./, "");
    m = /^([^@\s]+)@/.exec(line);
    if (m) return m[1]!;
    if (/^at\s+\S+:\d+:\d+$/.test(line)) return "anon";
  }
  return "anon";
}

function fnv(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function fingerprintOf(input: { kind: string; message: string; route: string; stack?: string | null }): string {
  const basis = [input.kind, normaliseMessage(input.message), routePattern(input.route), firstFrameFunction(input.stack)].join("|");
  return fnv(basis, 2166136261).toString(16).padStart(8, "0") + (fnv(basis, 0x9e3779b1) & 0xffff).toString(16).padStart(4, "0");
}
