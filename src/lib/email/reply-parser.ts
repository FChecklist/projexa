// Deterministic line-by-line parser for a digest reply. Deliberately NOT
// AI/LLM-assisted (Phase 2 scope, see HANDOFF/plan) -- applying a
// probabilistic interpretation to real construction/financial data without
// a human check is the exact class of risk the AI-Link work order's own
// charter already drew a hard line against ("nothing about money/budget/
// access/irreversible actions is in scope"). A line that can't be
// confidently matched to a known open item + an allowed verb is NEVER
// applied -- it's kept verbatim as free text for a human (an org admin) to
// read, via daily_report_note. No DB access in this file on purpose: it's
// pure, so its behavior is fully covered by unit tests with no database.

export type DigestItemForParsing = {
  refCode: number;
  entityType: string;
  allowedVerbs: string[];
  consumedAt: Date | string | null;
};

export type MatchedAction = { refCode: number; entityType: string; verb: string; payloadText: string };
export type RefusedLine = { refCode: number | null; reason: string; rawLine: string };

export type ParseResult = {
  matched: MatchedAction[];
  refused: RefusedLine[];
  /** Every line that wasn't a recognized numbered item action, joined -- becomes one daily_report_note row. */
  unmatchedText: string;
};

// Per entity type, in priority order -- first keyword match wins. Verbs not
// present in a given item's own `allowedVerbs` (set at issue time from the
// same vocabulary, scoped to what that item's current state actually
// permits) are skipped even if the keyword matches, so e.g. an RFI that
// hasn't been answered yet can't be "closed" by a reply just because the
// word appeared.
const VERB_VOCAB: Record<string, Array<{ verb: string; keywords: string[]; needsPayload: boolean }>> = {
  todo: [
    { verb: "done", keywords: ["done", "complete", "completed", "finish", "finished"], needsPayload: false },
    // Only an explicit "note:" prefix is stripped here -- a signal word like
    // "blocked" describing the situation, not prefixing a command, must
    // stay IN the payload (see DEFAULT_FREE_TEXT_VERB below: anything that
    // doesn't match "done" or an explicit "note:" prefix still becomes a
    // note, with the FULL line kept as its text).
    { verb: "note", keywords: ["note"], needsPayload: true },
  ],
  rfi: [
    { verb: "close", keywords: ["close", "closed"], needsPayload: false },
    { verb: "answer", keywords: ["answer", "ans"], needsPayload: true },
  ],
  submittal: [
    { verb: "approved", keywords: ["approve", "approved"], needsPayload: false },
    { verb: "approved_as_noted", keywords: ["approved_as_noted", "as noted", "noted"], needsPayload: false },
    { verb: "revise_resubmit", keywords: ["revise_resubmit", "revise", "resubmit"], needsPayload: false },
    { verb: "rejected", keywords: ["reject", "rejected"], needsPayload: false },
  ],
  punch_list: [
    { verb: "ready", keywords: ["ready"], needsPayload: false },
    { verb: "verify", keywords: ["verify", "verified"], needsPayload: false },
  ],
  billing_milestone: [
    { verb: "draft", keywords: ["draft"], needsPayload: false },
    { verb: "submit", keywords: ["submit", "submitted"], needsPayload: false },
    { verb: "approve", keywords: ["approve", "approved"], needsPayload: false },
    { verb: "reject", keywords: ["reject", "rejected"], needsPayload: true },
  ],
};

// If no keyword matches, some entity types have a safe "the rest of the
// line is just a note/answer" fallback; others (a state-machine transition
// like a submittal review or a punch-list verify) have no safe default --
// an unrecognized verb there must never silently pick one.
const DEFAULT_FREE_TEXT_VERB: Record<string, string | null> = {
  todo: "note",
  rfi: "answer",
  submittal: null,
  punch_list: null,
  billing_milestone: null,
};

function classify(entityType: string, allowedVerbs: string[], remainder: string): { verb: string; payloadText: string } | { error: string } {
  const trimmed = remainder.trim();
  const lower = trimmed.toLowerCase();
  const vocab = VERB_VOCAB[entityType] ?? [];

  for (const entry of vocab) {
    if (!allowedVerbs.includes(entry.verb)) continue;
    for (const keyword of entry.keywords) {
      const re = new RegExp(`^${keyword}\\b[:\\-]?\\s*`, "i");
      if (re.test(lower)) {
        const payloadText = trimmed.replace(re, "").trim();
        if (entry.needsPayload && !payloadText) return { error: "missing_payload" };
        return { verb: entry.verb, payloadText };
      }
    }
  }

  const fallbackVerb = DEFAULT_FREE_TEXT_VERB[entityType];
  if (fallbackVerb && allowedVerbs.includes(fallbackVerb) && trimmed) {
    return { verb: fallbackVerb, payloadText: trimmed };
  }

  return { error: trimmed ? "verb_not_recognized" : "empty_line" };
}

/**
 * `textBody` should be the reply's OWN new content, not the full thread --
 * prefer Postmark's `StrippedTextReply` field over `TextBody` at the
 * call site (see src/app/api/email/inbound/route.ts) so quoted history
 * from the original digest doesn't get re-parsed as if the user typed it.
 * Lines starting with `>` (a client that didn't strip quoting) are still
 * skipped here as a second line of defense.
 */
export function parseReply(items: DigestItemForParsing[], textBody: string): ParseResult {
  const byRefCode = new Map(items.map((item) => [item.refCode, item]));
  const matched: MatchedAction[] = [];
  const refused: RefusedLine[] = [];
  const freeformLines: string[] = [];

  for (const rawLine of textBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(">")) continue;

    const m = line.match(/^(\d{1,4})\s*[.:)\-]?\s*(.*)$/);
    if (!m) {
      freeformLines.push(line);
      continue;
    }

    const refCode = Number(m[1]);
    const remainder = m[2] ?? "";
    const item = byRefCode.get(refCode);

    if (!item) {
      refused.push({ refCode, reason: "unknown_ref_code", rawLine: line });
      freeformLines.push(line);
      continue;
    }
    if (item.consumedAt) {
      refused.push({ refCode, reason: "already_consumed", rawLine: line });
      continue;
    }

    const result = classify(item.entityType, item.allowedVerbs, remainder);
    if ("error" in result) {
      refused.push({ refCode, reason: result.error, rawLine: line });
      if (result.error !== "empty_line") freeformLines.push(line);
      continue;
    }

    matched.push({ refCode, entityType: item.entityType, verb: result.verb, payloadText: result.payloadText });
  }

  return { matched, refused, unmatchedText: freeformLines.join("\n").trim() };
}
