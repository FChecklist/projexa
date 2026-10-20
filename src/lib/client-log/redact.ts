// Redaction for the device log. Nothing here ever reads a request body, an Authorization header, a cookie or the value a person typed;
// this is the second line of defence for text that WAS captured (an error message, a server's own words, a button label).

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
// name = value / name: "value" / "name":"value", for names that look like secrets (password, token, secret, api key, authorization, cookie ...)
const NAMED_SECRET =
  /(["']?)\b([A-Za-z0-9_-]*(?:pass(?:word|wd)?|pwd|token|secret|api[_-]?key|apikey|private[_-]?key|authorization|cookie|credential|otp)[A-Za-z0-9_-]*|key)\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,&;}"')]+)/gi;
const PROVIDER_KEY = /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g;

/** Hides anything that looks like a credential, then caps the length. */
export function scrubText(input: unknown, max = 500): string {
  let s = typeof input === "string" ? input : input == null ? "" : safeString(input);
  s = s
    .replace(JWT, "[hidden]")
    .replace(BEARER, "$1 [hidden]")
    .replace(PROVIDER_KEY, "[hidden]")
    .replace(NAMED_SECRET, (_m, q: string, name: string, sep: string) => `${q}${name}${q}${sep}[hidden]`);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function safeString(v: unknown): string {
  try {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch {
    return "[unprintable]";
  }
}

/** Path only: the query string (tokens, search text, other people's ids) never leaves the device. */
export function safePath(urlLike: string): string {
  try {
    return new URL(urlLike, "http://local.invalid").pathname.slice(0, 300);
  } catch {
    return urlLike.split("?")[0]!.split("#")[0]!.slice(0, 300);
  }
}

// Our own event fields (sessionId, requestId, apiPath ...) must survive; only real secret NAMES are blanked.
const SECRET_FIELD_NAME = /^(pass(word|wd)?|pwd|token|secret|key|api[_-]?key|apikey|private[_-]?key|authorization|cookie|credential|otp|access_token|refresh_token|client_secret)$/i;

/** Walks any value; a key that names a secret has its value replaced, every string is scrubbed. Run over the whole event before it is stored. */
export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return "[deep]" as unknown as T;
  if (typeof value === "string") return scrubText(value, 4000) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_FIELD_NAME.test(k) ? "[hidden]" : redactDeep(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
