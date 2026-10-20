// The organisation name given to a person who signed in by e-mail code and never typed one. Nobody is asked; they can rename it later in Settings.
// A work address names the company ("asha@lakeview-builders.co.in" -> "Lakeview Builders"); a personal-mail address gets "My Company".

const PERSONAL_DOMAINS = new Set([
  "gmail", "googlemail", "yahoo", "ymail", "rocketmail", "outlook", "hotmail", "live", "msn", "icloud", "me", "mac", "aol", "proton", "protonmail", "pm",
  "zoho", "rediffmail", "gmx", "mail", "yandex", "qq", "163", "126", "hey", "fastmail", "tutanota", "inbox",
]);
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ltd", "plc", "pvt"]);

export const FALLBACK_ORG_NAME = "My Company";

export function defaultOrgName(email: string | null | undefined): string {
  const domain = (email ?? "").split("@")[1]?.trim().toLowerCase();
  if (!domain) return FALLBACK_ORG_NAME;
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return FALLBACK_ORG_NAME;
  // Drop the TLD, then a second-level suffix such as "co" in "x.co.in".
  const rest = labels.slice(0, -1);
  while (rest.length > 1 && SECOND_LEVEL.has(rest[rest.length - 1]!)) rest.pop();
  const company = rest[rest.length - 1]!;
  if (PERSONAL_DOMAINS.has(company)) return FALLBACK_ORG_NAME;
  const words = company.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return FALLBACK_ORG_NAME;
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}
