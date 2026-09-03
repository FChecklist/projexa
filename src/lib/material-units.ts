// R67 G-05 (R-260): "The Materials Unit field becomes a select so 'bag' and
// 'Bag' cannot coexist."
//
// THE DEFECT. Unit was a free-text Input with the placeholder "e.g. bag, cum,
// kg". Free text on a field that is really an enumeration produces a
// vocabulary, not a value: "bag", "Bag", "bags", "BAG" and "bag " are five
// distinct strings to every consumer downstream -- the materials cost report
// groups by unit, so five spellings of one unit become five rows that each
// look like a different material, and no total is right.
//
// This is the closed vocabulary. It is deliberately short and deliberately
// lower-case: a unit is a unit of measure, not a label, and the display
// casing is decided here rather than by whoever typed it first.

export type MaterialUnit = { value: string; label: string };

/**
 * Grouped by what is being measured, because that is how a site engineer
 * chooses one. Values are the canonical lower-case strings that get stored;
 * labels are what the reader picks from.
 */
export const MATERIAL_UNITS: MaterialUnit[] = [
  // Count
  { value: "nos", label: "nos (number)" },
  { value: "bag", label: "bag" },
  { value: "roll", label: "roll" },
  { value: "set", label: "set" },
  { value: "coil", label: "coil" },
  // Length
  { value: "m", label: "m (metre)" },
  { value: "rmt", label: "rmt (running metre)" },
  // Area
  { value: "sqm", label: "sqm (square metre)" },
  { value: "sqft", label: "sqft (square foot)" },
  // Volume
  { value: "cum", label: "cum (cubic metre)" },
  { value: "litre", label: "litre" },
  // Mass
  { value: "kg", label: "kg" },
  { value: "ton", label: "ton (metric tonne)" },
  // Time / effort
  { value: "day", label: "day" },
  { value: "hour", label: "hour" },
  // Whole-item pricing
  { value: "ls", label: "ls (lump sum)" },
];

const BY_VALUE = new Map(MATERIAL_UNITS.map((u) => [u.value, u]));

/**
 * Folds the spellings that already exist in real data onto the canonical
 * value: trims, lower-cases, and drops a trailing plural "s" when that
 * produces a known unit ("bags" -> "bag", but "nos" stays "nos" because it is
 * a unit in its own right and is checked first).
 *
 * Returns null for anything it does not recognise, so an existing row with a
 * unit outside the vocabulary is shown as-is rather than silently rewritten
 * to something it never said.
 */
export function normaliseMaterialUnit(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (BY_VALUE.has(trimmed)) return trimmed;
  if (trimmed.endsWith("s")) {
    const singular = trimmed.slice(0, -1);
    if (BY_VALUE.has(singular)) return singular;
  }
  return null;
}

/** True when `value` is already one of the canonical units. */
export function isMaterialUnit(value: string | null | undefined): boolean {
  return Boolean(value && BY_VALUE.has(value.trim().toLowerCase()));
}

/** The label to show for a stored unit; falls back to the raw string for legacy rows. */
export function materialUnitLabel(value: string | null | undefined): string {
  if (!value) return "";
  return BY_VALUE.get(value.trim().toLowerCase())?.label ?? value;
}
