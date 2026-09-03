import Link from "next/link";
import { type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DashboardCardVariant = "total" | "overdue" | "pending" | "completed";

type DashboardCardProps = {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: LucideIcon;
  variant: DashboardCardVariant;
  className?: string;
  /**
   * R67 E-06 (R-108): a KPI tile with no destination is a dead end -- the
   * reader is told a number and given nowhere to go and check it. When an
   * href is given the whole tile becomes a link, and hrefLabel is the words
   * that say where it goes ("Open budget"), so the destination is readable
   * and not just hover-discoverable.
   */
  href?: string;
  hrefLabel?: string;
};

// R67 WS-G (R-227). Two changes, both about what a KPI tile is allowed to say
// with colour.
//
// 1. THE FIGURE IS ALWAYS NAVY. Every variant used to colour-code its own
//    value -- red for overdue, amber for pending, teal for completed -- so
//    "Total Expenses" rendered in the same amber as an overdue warning purely
//    because of which slot it sat in. A number is a number; it is not good or
//    bad, and the tile's own title already says what it is. valueText is gone
//    from this map entirely: there is no way to colour a KPI figure any more.
// 2. THE ACCENT COMES FROM THE PALETTE, NOT FROM TAILWIND'S DEFAULTS.
//    red-500/red-600 and amber-500/amber-600 were raw Tailwind colours that
//    belonged to no token in this app, sat outside the muted CVD-checked set,
//    and put a loud red on a tile that is not an error. They are now the
//    chart tokens: rose (--chart-4) for overdue and clay (--chart-3) for
//    pending, which is the same rose/clay a status chip uses, so one language
//    across cards and chips.
//
// The border and the icon still tint, because a tint on a 4px rule and a
// 44px icon plate is decoration -- the tile's TITLE carries the meaning, and
// the icon is a second, non-colour cue on top of it.
//
// Deliberately inline styles rather than Tailwind arbitrary-value utilities:
// these are CSS custom properties resolved at paint time, so there is nothing
// for the content scanner to find and nothing that can silently fail to
// generate a rule -- the exact failure mode globals.css's own @source comment
// documents for this repo.
const variantStyles: Record<
  DashboardCardVariant,
  { borderColor: string; iconBg: string; iconColor: string }
> = {
  total: {
    borderColor: "var(--foreground)",
    iconBg: "color-mix(in srgb, var(--foreground) 10%, transparent)",
    iconColor: "var(--foreground)",
  },
  overdue: {
    borderColor: "var(--chart-4)",
    iconBg: "color-mix(in srgb, var(--chart-4) 14%, transparent)",
    iconColor: "var(--status-late-text)",
  },
  pending: {
    borderColor: "var(--chart-3)",
    iconBg: "color-mix(in srgb, var(--chart-3) 16%, transparent)",
    iconColor: "var(--status-needs-you-text)",
  },
  completed: {
    borderColor: "var(--chart-2)",
    iconBg: "color-mix(in srgb, var(--chart-2) 16%, transparent)",
    iconColor: "var(--status-done-text)",
  },
};

export function DashboardCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant,
  className,
  href,
  hrefLabel,
}: DashboardCardProps) {
  const styles = variantStyles[variant];

  const card = (
    <Card
      className={cn(
        "border-l-4 shadow-card transition-shadow hover:shadow-md",
        href && "h-full cursor-pointer focus-within:shadow-md",
        className
      )}
      style={{ borderLeftColor: styles.borderColor }}
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-lg"
          style={{ background: styles.iconBg }}
        >
          <Icon className="size-5" style={{ color: styles.iconColor }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ct-muted uppercase tracking-wide">
            {title}
          </p>
          {/* R67 WS-G: navy, always. KPI figures are never colour-coded. */}
          <p className="text-2xl font-bold leading-tight mt-0.5 text-ct-navy tabular-nums">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-ct-muted mt-1 truncate">{subtitle}</p>
          )}
          {href && hrefLabel && (
            <p className="mt-1 text-xs font-medium text-brand-text">{hrefLabel} &rarr;</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // The whole tile is the link, so the target is the size of the card rather
  // than a word inside it -- and it is a real anchor, so Tab reaches it and
  // the browser's own "open in new tab" works.
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
      {card}
    </Link>
  ) : (
    card
  );
}