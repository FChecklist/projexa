"use client";

// R52 PHASE B -- HOME becomes the grouped module directory.
//
// M24, and this is the sentence that makes it load-bearing rather than nice to
// have: "HOME = THE GROUPED MODULE DIRECTORY, rendered in the RIGHT pane. It
// REPLACES the left rail, WHICH IS WHY THE RAIL COULD BE DELETED AT ALL."
//
// WHY THIS EXISTS NOW: the M24 shell deleted the left rail before this was
// built. For that window every destination the rail used to reach was
// URL-only -- 46 shipped routes with no in-app way to get to them. That was a
// regression introduced by the shell adoption, not a pre-existing gap, and
// this closes it.
//
// "GROUPED BY DOMAIN, NEVER A FLAT GRID. Eleven cards is a dashboard; eighty
// is a wall. The 47-item nav already has the groups." So this renders the SAME
// VISIBLE_NAV_SECTIONS the sidebar used, from the SAME filtered source -- if
// it rebuilt its own list the two would drift and a module could exist in one
// and not the other. filterShippedNav has already dropped any entry whose
// route has no page, so nothing here can be a dead end.
//
// "HOME IS THE TEACHER: everything else in this design is earned (history,
// pinning, ranking) and a new user has none of it." Hence: real labels, no
// icon-only cards, and the domain heading always visible so the vocabulary is
// learned by reading rather than by exploring.

//
// R67 F-22 (audit recommendation R-247): every card here now speculates on
// hover or focus, after a 100 ms hover-intent delay -- the route's own payload
// via router.prefetch() and the module's primary list call via the bounded
// prefetch store. A cursor dragged across the grid fires nothing; a cursor
// that stops on a card gets that screen's rows before the click.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { VISIBLE_NAV_SECTIONS } from "@/components/AppSidebar";
import { useHoverPrefetch } from "@/lib/use-hover-prefetch";
import { readSelectedProjectId } from "@/lib/project-cookie";
import { useEffect, useState } from "react";

export default function ModuleDirectory({ projectId }: { projectId?: string | null }) {
  const t = useTranslations("Nav");
  // The rail's own selection, read once on mount -- the directory is rendered
  // without a project prop on the dashboard, and speculation needs one to
  // build the list url.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);
  useEffect(() => {
    setSelectedProjectId(projectId ?? readSelectedProjectId());
  }, [projectId]);
  const { hoverProps } = useHoverPrefetch(selectedProjectId);

  // Carry the project through, so a card lands on the module already scoped to
  // the project in the top rail rather than resetting it. M24 treats acting on
  // the wrong project as the most expensive mistake in the product.
  const withProject = (href: string) => (projectId ? `${href}?projectId=${encodeURIComponent(projectId)}` : href);

  return (
    <section aria-label="All modules" className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold" style={{ color: "var(--color-ct-navy)" }}>
          All modules
        </h2>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--color-ct-muted)" }}>
          Everything in this workspace, grouped by what it is for.
        </p>
      </div>

      {VISIBLE_NAV_SECTIONS.map((section, i) => (
        <div key={section.titleKey ?? `section-${i}`} className="space-y-2">
          {section.titleKey && (
            <h3
              className="text-[11px] font-semibold tracking-wide"
              style={{ color: "var(--color-ct-muted)" }}
            >
              {t(section.titleKey)}
            </h3>
          )}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={withProject(item.href)}
                    {...hoverProps(item.href)}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[12.5px] transition-colors hover:bg-[var(--color-ct-cloud)]"
                    style={{ borderColor: "var(--color-ct-border)", color: "var(--color-ct-navy)" }}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {/* A word, never an icon alone -- the same rule the control
                        strip follows. A site engineer reads this on his first
                        morning. */}
                    <span className="truncate">{t(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
