// LOCAL-FIRST R12 ("the user does not have to think"): the field-level THREE-WAY MERGE the outbox does when the server's row
// moved while the person's edit waited. Pure functions, no database, no network: outbox.ts calls them and stores the result.
//
//   base   = what the edited fields held when the person made the edit (`op.before`, recorded at enqueue)
//   mine   = what the edit set them to (`op.effect`, recorded at enqueue: the optimistic change's own diff of the row)
//   theirs = the server's current row (the conflict answer's `server.data`)
//
// Per field the edit changed:
//   theirs == mine                 nothing to decide (both sides agree)
//   theirs == base                 only the person changed it: theirs is kept for everything else, mine for this field
//   anything else                  BOTH changed it, to different values: a same-field disagreement -> the person's card
// Fields only the server changed are never in the edit, so re-sending the edit (against the new version) keeps them.
//
// Never merged on the laptop: a money or an approval field (owner rule: money and approvals are decided by the server). If
// the edit touches one, any conflict goes to the card, whatever the fields say.
//
// KEY SHAPES. The optimistic overlay uses the registry's camelCase parameter names (statusId, dueDate) while the server's
// row may carry snake_case (status_id, due_date); a field is read under either name, so `statusId` and `status_id` are the
// same field here. Nothing is ever invented: an unknown base (an op stored before schema 4) counts as "both changed it".

export type Data = Record<string, unknown>;

export const asData = (value: unknown): Data => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Data) : {});

const snake = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** The field's value under its own name, or its snake_case / camelCase twin. Undefined when the row has neither. */
export function fieldValue(data: Data, key: string): unknown {
  if (key in data) return data[key];
  const s = snake(key);
  if (s in data) return data[s];
  const c = camel(key);
  if (c in data) return data[c];
  return undefined;
}

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Data).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Data)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Deep equality on JSON values; undefined and null are the same ("empty"). */
export const same = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);

/** What an optimistic change did to a row's data: the top-level keys whose value changed (a removed key -> null). */
export function effectOf(before: unknown, after: unknown): Data {
  const a = asData(before);
  const b = asData(after);
  const out: Data = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!same(a[key], b[key])) out[key] = key in b ? b[key] : null;
  }
  return out;
}

/** The same keys as `effect`, as `before` held them (absent -> null). */
export function beforeOf(before: unknown, effect: Data): Data {
  const a = asData(before);
  const out: Data = {};
  for (const key of Object.keys(effect)) out[key] = key in a ? a[key] : null;
  return out;
}

/** Money and approval fields: never merged on the laptop. */
const PROTECTED = /(amount|rate|price|cost|budget|money|currency|total|value|payment|invoice|retention|approv|sign_?off|authori[sz])/i;
export const isProtectedField = (key: string) => PROTECTED.test(key);

export type MergeDecision =
  /** Every field the edit changed already holds the edit's value on the server: it is already in. */
  | { kind: "already_in" }
  /** No field disagrees: re-send the edit against the server's version; the row shows theirs with mine on top. */
  | { kind: "merged"; data: Data }
  /** The person decides. `fields`: the ones that disagree (all the edit's fields when a protected one is involved). */
  | { kind: "card"; fields: string[] };

/** The three-way decision for one edit against the server's current row. */
export function decide(input: { effect: Data; before?: Data; theirs: unknown }): MergeDecision {
  const theirs = asData(input.theirs);
  const keys = Object.keys(input.effect);
  if (keys.length === 0) return { kind: "card", fields: [] };
  const differing = keys.filter((k) => !same(fieldValue(theirs, k), input.effect[k]));
  if (differing.length === 0) return { kind: "already_in" };
  if (keys.some(isProtectedField)) return { kind: "card", fields: differing };
  const disagree = differing.filter((k) => !(input.before && k in input.before && same(fieldValue(theirs, k), input.before[k])));
  if (disagree.length > 0) return { kind: "card", fields: disagree };
  return { kind: "merged", data: overlay(theirs, input.effect) };
}

/** `data` with the edit's fields on top, each written under the name the row already uses for it. */
export function overlay(data: unknown, effect: Data): Data {
  const out: Data = { ...asData(data) };
  for (const [key, value] of Object.entries(effect)) {
    const name = key in out ? key : snake(key) in out ? snake(key) : camel(key) in out ? camel(key) : key;
    out[name] = value;
  }
  return out;
}

/** The edit's effect when an op has none recorded (made before schema 4): its parameters minus the ids that name the target. */
export function effectFromParams(params: Data, targetId: string | null): Data {
  const out: Data = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "projectId" || (targetId !== null && value === targetId)) continue;
    out[key] = value;
  }
  return out;
}

/** The parameters without the given fields (under either spelling): what is left to send after "keep theirs" on those fields. */
export function withoutFields(params: Data, fields: string[]): Data {
  const drop = new Set(fields.flatMap((f) => [f, snake(f), camel(f)]));
  const out: Data = {};
  for (const [key, value] of Object.entries(params)) if (!drop.has(key)) out[key] = value;
  return out;
}
