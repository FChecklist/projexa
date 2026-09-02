"use client";

// R67 G-05 (R-260). "An organisation with no currency set shows 'Currency not
// set → Settings' once in the footer and renders bare numbers with a warning
// glyph rather than guessing."
//
// ONCE, and in the FOOTER, both deliberately. Measured 2026-08-26: 4 of 5
// real orgs have no erp_currencies base row, so for those orgs every money
// figure on every screen is unlabelled. Repeating the explanation beside each
// of forty rows would bury the data it is explaining; saying it once at the
// foot of the screen tells the reader what the warning glyph beside each
// figure means, and where to go to make it stop.
//
// It is a LINK, not a toast and not a banner: the reader can act on it now or
// keep reading, and it does not move anything they are already aiming at.
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { CURRENCY_NOT_SET_NOTICE } from "@/lib/format-money";

/**
 * Renders nothing when the org HAS a currency -- so a screen can mount this
 * unconditionally and let the one component own the decision, rather than
 * every screen re-deriving it.
 *
 * ...and nothing while `loaded` is false either. On a client screen the
 * currency arrives from /api/currencies a beat after first paint, and
 * `currencySet` is false for that whole window; without this flag the notice
 * asserted "Currency not set" on every page load, for every org, including the
 * ones that have a currency. `loaded` defaults to true so a Server Component
 * that already holds the resolved currency (DashboardHomeView) needs no flag.
 */
export function CurrencyNotSetNotice({
  currencySet,
  loaded = true,
  className,
}: {
  currencySet: boolean;
  loaded?: boolean;
  className?: string;
}) {
  if (!loaded || currencySet) return null;
  const [text, destination] = CURRENCY_NOT_SET_NOTICE.split(" → ");
  return (
    <p className={`flex items-center gap-1.5 pt-1 text-[12px] ${className ?? ""}`} style={{ color: "var(--status-needs-you-text)" }}>
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      <span>
        {text} →{" "}
        <Link href="/settings" className="underline underline-offset-2 hover:no-underline">
          {destination}
        </Link>
      </span>
    </p>
  );
}
