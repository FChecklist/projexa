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
const variantStyles: Record<
  DashboardCardVariant,
  { border: string; iconBg: string; iconColor: string }
> = {
  total: {
    border: "border-l-ct-navy",
    iconBg: "bg-ct-navy/10",
    iconColor: "var(--foreground)",
  },
  overdue: {
    border: "border-l-[color:var(--chart-4)]",
    iconBg: "bg-[color:color-mix(in_srgb,var(--chart-4)_14%,transparent)]",
    iconColor: "var(--status-late-text)",
  },
  pending: {
    border: "border-l-[color:var(--chart-3)]",
    iconBg: "bg-[color:color-mix(in_srgb,var(--chart-3)_16%,transparent)]",
    iconColor: "var(--status-needs-you-text)",
  },
  completed: {
    border: "border-l-[color:var(--chart-2)]",
    iconBg: "bg-[color:color-mix(in_srgb,var(--chart-2)_16%,transparent)]",
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
}: DashboardCardProps) {
  const styles = variantStyles[variant];

  return (
    <Card
      className={cn(
        "border-l-4 shadow-card transition-shadow hover:shadow-md",
        styles.border,
        className
      )}
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-lg",
            styles.iconBg
          )}
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
        </div>
      </CardContent>
    </Card>
  );
}