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

const variantStyles: Record<
  DashboardCardVariant,
  { border: string; iconBg: string; iconText: string; valueText?: string }
> = {
  total: {
    border: "border-l-ct-navy",
    iconBg: "bg-ct-navy/10",
    iconText: "text-ct-navy",
  },
  overdue: {
    border: "border-l-red-500",
    iconBg: "bg-red-50",
    iconText: "text-red-600",
    valueText: "text-red-600",
  },
  pending: {
    border: "border-l-amber-500",
    iconBg: "bg-amber-50",
    iconText: "text-amber-600",
    valueText: "text-amber-600",
  },
  completed: {
    border: "border-l-ct-teal",
    iconBg: "bg-ct-teal/10",
    iconText: "text-ct-teal",
    valueText: "text-ct-teal",
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
          <Icon className={cn("size-5", styles.iconText)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ct-muted uppercase tracking-wide">
            {title}
          </p>
          <p
            className={cn(
              "text-2xl font-bold leading-tight mt-0.5",
              styles.valueText ?? "text-ct-navy"
            )}
          >
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