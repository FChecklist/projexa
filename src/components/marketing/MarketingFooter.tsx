import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "./marketing-locale";

// OT6 (docs/OWNER_RUNBOOKS_2026-09-09.md): the owner-supplied reply email,
// read from env with an empty-string fallback -- same idiom as
// src/lib/currency.ts's NEXT_PUBLIC_DEFAULT_CURRENCY_CODE. Still unsupplied
// as of this run, so the link stays hidden; the code path exists and is
// correct so the owner only has to set the env var, never touch this
// component.
//
// PM ruling (2026-09-10, post-A4): no WhatsApp Business API and no business
// phone number -- NEXT_PUBLIC_WA_NUMBER is dead, not just unset, and was
// removed here rather than left empty. The ruling also describes a
// system-wide "Copy link" control replacing WhatsApp on every actionable
// item, governed by a single rule the ruling names as lib/share-link-usable.ts
// -- that file was not found anywhere in this checkout (C:\ct\ct or
// C:\ct\projexa) as of this commit, so that broader feature is NOT
// implemented here; flagged back to the PM rather than guessed at. This
// footer only had the WhatsApp link removed.
const REPLY_EMAIL = (process.env.NEXT_PUBLIC_REPLY_EMAIL ?? "").trim();

export async function MarketingFooter({ locale }: MarketingLocaleProps) {
  const t = await getTranslations({ locale, namespace: "Marketing.footer" });

  return (
    <footer className="bg-px-ink py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Image src="/logo-mark.svg" alt="PROJEXA" width={22} height={22} />
          <span className="font-heading text-sm font-semibold text-white">PROJEXA</span>
          <span className="text-sm text-px-cloud2/60">{t("tagline")}</span>
        </div>
        <div className="flex items-center gap-6 text-sm text-px-cloud2">
          <Link href="/login" className="hover:text-white">{t("login")}</Link>
          <Link href="/signup" className="hover:text-white">{t("signup")}</Link>
          {REPLY_EMAIL && (
            <a href={`mailto:${REPLY_EMAIL}`} className="hover:text-white">{REPLY_EMAIL}</a>
          )}
        </div>
        <p className="text-xs text-px-cloud2/50">{t("copyright", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
