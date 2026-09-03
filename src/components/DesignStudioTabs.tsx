"use client";

// R67 WS-H (items H-03/H-04). The Design Studio's three tabs -- "My
// timesheet", "Review", "Cost analysis".
//
// They are REAL ROUTES, not client state, deliberately: item H-04 asks for
// /design-studio/review and /design-studio/cost-analysis specifically, and a
// manager sent a link to "the review queue" has to land on the review queue.
// Item H-03's "three tabs" and item H-04's "three routes" are the same
// screen described from two ends; this is the shape that satisfies both.
import Link from "next/link";
import { usePathname } from "next/navigation";

export const DESIGN_STUDIO_TABS = [
  { href: "/design-studio", label: "My timesheet" },
  { href: "/design-studio/review", label: "Review" },
  { href: "/design-studio/cost-analysis", label: "Cost analysis" },
] as const;

export default function DesignStudioTabs({ projectId }: { projectId?: string | null }) {
  const pathname = usePathname();
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";

  return (
    <nav aria-label="Design Studio" className="flex items-center gap-1 border-b border-px-border px-4">
      {DESIGN_STUDIO_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${query}`}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "border-b-2 border-px-ink px-3 py-2 text-[13px] font-medium text-px-ink"
                : "border-b-2 border-transparent px-3 py-2 text-[13px] text-px-muted hover:text-px-ink"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
