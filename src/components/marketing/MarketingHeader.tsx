"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// Exact order + 8 labels as specified by the site owner -- do not reorder or
// reword. Every entry except "howItWorks" is a same-page anchor on the
// homepage; "howItWorks" is a real route. See the `href()` helper below for
// why these live as bare anchor ids rather than full hrefs: this header is
// shared by both marketing pages, and an anchor that's same-page on "/" has
// to become "/#id" when rendered from "/how-it-works" (the "one integrated
// site" requirement -- nav must actually work from either page, not just
// look identical).
const NAV_LINK_KEYS = [
  { key: "aiOs", anchor: "ai-os" },
  { key: "system", anchor: "system" },
  { key: "howItWorks", href: "/how-it-works" },
  { key: "paysForItself", anchor: "pays-for-itself" },
  { key: "selfCoordination", anchor: "self-coordination" },
  { key: "modules", anchor: "modules" },
  { key: "veri", anchor: "veri" },
  { key: "value", anchor: "value" },
] as const;

export function MarketingHeader() {
  const t = useTranslations("Marketing.header");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === "/";

  function linkHref(link: (typeof NAV_LINK_KEYS)[number]): string {
    if ("href" in link) return link.href;
    return isHome ? `#${link.anchor}` : `/#${link.anchor}`;
  }

  const contactHref = isHome ? "#contact" : "/#contact";

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-px-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Image src="/logo-mark.svg" alt="PROJEXA" width={28} height={28} />
          <span className="font-heading text-lg font-semibold text-white">PROJEXA</span>
        </Link>

        <nav className="hidden items-center gap-5 xl:flex">
          {NAV_LINK_KEYS.map((link) => {
            const isRoute = "href" in link;
            const active = isRoute && pathname === link.href;
            return (
              <Link
                key={link.key}
                href={linkHref(link)}
                className={`text-sm font-medium transition-colors hover:text-white ${
                  active ? "text-white" : "text-px-cloud2"
                }`}
              >
                {t(`navLinks.${link.key}`)}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 xl:flex">
          <Button asChild variant="ghost" className="text-px-cloud2 hover:bg-white/10 hover:text-white">
            <Link href="/login">{t("login")}</Link>
          </Button>
          {/* R67 WS-G / C-13: navy on the unchanged saffron fill (5.55:1) is
              the preferred fix; --brand-fill-deep is the fallback for white
              text, which this CTA does not need. */}
          <Button asChild className="bg-px-orange text-ct-navy shadow-orange hover:bg-px-orange-hover">
            <Link href={contactHref}>
              {t("talkToEngineer")} <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-white xl:hidden"
          aria-label={open ? t("closeMenu") : t("openMenu")}
          aria-expanded={open}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-px-ink px-4 pb-6 pt-2 xl:hidden">
          <nav className="flex flex-col gap-1">
            {NAV_LINK_KEYS.map((link) => (
              <Link
                key={link.key}
                href={linkHref(link)}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2.5 text-sm font-medium text-px-cloud2 hover:bg-white/5 hover:text-white"
              >
                {t(`navLinks.${link.key}`)}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <Button asChild variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
              <Link href="/login" onClick={() => setOpen(false)}>{t("login")}</Link>
            </Button>
            <Button asChild className="bg-px-orange text-ct-navy hover:bg-px-orange-hover">
              <Link href={contactHref} onClick={() => setOpen(false)}>
                {t("talkToEngineer")} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
