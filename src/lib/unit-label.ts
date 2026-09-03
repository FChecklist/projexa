// R67 D-40. A quantity refusal has to read like a sentence a storekeeper would
// say -- "Only 120 bags on hand", not "Only 120 bag on hand" and not
// "quantity exceeds available".
//
// The unit column is free text set per material, so this cannot be a lookup
// table of every unit that will ever exist. It is the smallest rule that gets
// the common cases right and, crucially, LEAVES ALONE the ones where a plural
// would be wrong: unit SYMBOLS are already plural-invariant ("120 kg", never
// "120 kgs" on a delivery note; "5 cum", never "5 cums"), while countable
// nouns -- bag, drum, roll, sheet, coil, pack -- do take one.
//
// When in doubt this returns the unit UNCHANGED. A missing "s" reads as terse;
// an invented one reads as a system that does not know what it is measuring.

/**
 * Units that are symbols or abbreviations rather than countable nouns. Kept
 * lowercase; the comparison is case-insensitive.
 */
const INVARIANT_UNITS = new Set([
  // mass
  "kg", "g", "mg", "t", "mt", "ton", "tonne", "lb", "lbs",
  // length
  "m", "cm", "mm", "km", "ft", "in", "rmt", "rft", "lm",
  // area / volume
  "m2", "m3", "sqm", "sqft", "cum", "cft", "cbm",
  // capacity / count-ish abbreviations
  "l", "ml", "ltr", "nos", "no", "pcs", "qty", "set", "each", "ea", "unit",
]);

/**
 * `pluraliseUnit("bag", 120) === "bags"`, `pluraliseUnit("kg", 120) === "kg"`,
 * `pluraliseUnit("bag", 1) === "bag"`.
 */
export function pluraliseUnit(unit: string | null | undefined, quantity: number): string {
  const value = (unit ?? "").trim();
  if (!value) return "";
  if (quantity === 1) return value;
  const lower = value.toLowerCase();
  if (INVARIANT_UNITS.has(lower)) return value;
  if (lower.endsWith("s")) return value;
  return `${value}s`;
}

/**
 * The one sentence used when someone tries to issue more than is on site. The
 * server refuses with its own copy of this fact (see createMaterialIssue), so
 * this is the FIELD-level warning, not the authority.
 */
export function onHandLimitMessage(onHand: number, unit: string | null | undefined): string {
  return `Only ${onHand} ${pluraliseUnit(unit, onHand)} on hand`.replace(/\s+/g, " ").trim();
}

export const QUANTITY_TOO_SMALL_MESSAGE = "Enter a quantity greater than 0";

/**
 * The Issue form's whole quantity rule, kept out of the component so it can be
 * exercised directly: `undefined` means "nothing to say yet" (an untouched
 * field is not an error), and every other answer is the exact sentence shown
 * under the field AND inside the disabled Save label.
 *
 * `onHand` is null when no material has been chosen yet -- the balance is
 * unknown, so only the "greater than 0" half of the rule can be applied.
 */
export function issueQuantityError(
  rawQuantity: string,
  onHand: number | null,
  unit: string | null | undefined
): string | undefined {
  if (!rawQuantity) return undefined;
  const value = Number(rawQuantity);
  if (!Number.isFinite(value) || value <= 0) return QUANTITY_TOO_SMALL_MESSAGE;
  if (onHand !== null && value > onHand) return onHandLimitMessage(onHand, unit);
  return undefined;
}
