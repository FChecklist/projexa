"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

const NAV_LINK_KEYS = [
  { key: "coordination", href: "#problem" },
  { key: "modules", href: "#modules" },
  { key: "copilot", href: "#copilot" },
  { key: "value", href: "#value" },
] as const;

export function MarketingHeader() {
  const t = useTranslations("Marketing.header");
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-px-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo-mark.svg" alt="PROJEXA" width={28} height={28} />
          <span className="font-heading text-lg font-semibold text-white">PROJEXA</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINK_KEYS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-px-cloud2 transition-colors hover:text-white"
            >
              {t(`navLinks.${link.key}`)}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Button asChild variant="ghost" className="text-px-cloud2 hover:bg-white/10 hover:text-white">
            <Link href="/login">{t("login")}</Link>
          </Button>
          <Button asChild className="bg-px-orange text-white shadow-orange hover:bg-px-orange-hover">
            <Link href="/signup">
              {t("startFree")} <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-white md:hidden"
          aria-label={open ? t("closeMenu") : t("openMenu")}
          aria-expanded={open}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-px-ink px-4 pb-6 pt-2 md:hidden">
          <nav className="flex flex-col gap-1">
            {NAV_LINK_KEYS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2.5 text-sm font-medium text-px-cloud2 hover:bg-white/5 hover:text-white"
              >
                {t(`navLinks.${link.key}`)}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <Button asChild variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
              <Link href="/login">{t("login")}</Link>
            </Button>
            <Button asChild className="bg-px-orange text-white hover:bg-px-orange-hover">
              <Link href="/signup">
                {t("startFree")} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
