"use client";

// The upper two thirds of the left pane in Traditional View: the module menu.
// It renders the SAME VISIBLE_NAV_SECTIONS the Home directory renders, so a
// module cannot exist in one and not the other (see ModuleDirectory.tsx).
// The project in the top rail is carried into each link, as the directory does.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { VISIBLE_NAV_SECTIONS } from "@/components/AppSidebar";

export default function TraditionalMenu({ projectId }: { projectId?: string | null }) {
  const t = useTranslations("Nav");
  const pathname = usePathname() ?? "";
  const withProject = (href: string) => (projectId ? `${href}?projectId=${encodeURIComponent(projectId)}` : href);
  return (
    <nav aria-label="Modules" className="h-full overflow-y-auto py-2" style={{ scrollbarGutter: "stable" }}>
      {VISIBLE_NAV_SECTIONS.map((section, i) => (
        <div key={section.titleKey ?? `section-${i}`} className="pb-2">
          {section.titleKey && (
            <h3
              className="px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wide"
              style={{ color: "var(--color-ct-muted)" }}
            >
              {t(section.titleKey)}
            </h3>
          )}
          <ul>
            {section.items.map((item) => {
              const Icon = item.icon;
              const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={withProject(item.href)}
                    aria-current={current ? "page" : undefined}
                    className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-[var(--color-ct-cloud)]"
                    style={{
                      color: "var(--color-ct-navy)",
                      background: current ? "var(--color-ct-cloud)" : undefined,
                      fontWeight: current ? 600 : 400,
                      borderLeft: current ? "3px solid var(--color-ct-saffron, #f5820a)" : "3px solid transparent",
                    }}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
