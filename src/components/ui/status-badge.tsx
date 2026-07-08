import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status =
  | "pending"
  | "in_progress"
  | "completed"
  | "overdue"
  | "not_applicable"
  | "draft";

type Priority = "low" | "medium" | "high" | "critical";

const statusConfig: Record<Status, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  },
  in_progress: {
    label: "In Progress",
    className:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
  },
  completed: {
    label: "Completed",
    className:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800",
  },
  overdue: {
    label: "Overdue",
    className:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",
  },
  not_applicable: {
    label: "N/A",
    className:
      "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700",
  },
  draft: {
    label: "Draft",
    className:
      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800",
  },
};

const priorityConfig: Record<Priority, { label: string; className: string }> = {
  low: {
    label: "Low",
    className:
      "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/30 dark:text-slate-300 dark:border-slate-700",
  },
  medium: {
    label: "Medium",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  },
  high: {
    label: "High",
    className:
      "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800",
  },
  critical: {
    label: "Critical",
    className:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",
  },
};

type StatusBadgeProps = {
  status: Status | string;
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status as Status];
  if (!config) {
    return (
      <Badge variant="outline" className={className}>
        {status}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}

type PriorityBadgeProps = {
  priority: Priority | string;
  className?: string;
};

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const config = priorityConfig[priority as Priority];
  if (!config) {
    return (
      <Badge variant="outline" className={className}>
        {priority}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}

