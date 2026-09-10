import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { MarketingLocaleProps } from "./marketing-locale";

// OT6 (docs/OWNER_RUNBOOKS_2026-09-09.md): the owner-supplied WhatsApp
// number and reply email, read from env with an empty-string fallback --
// same idiom as src/lib/currency.ts's NEXT_PUBLIC_DEFAULT_CURRENCY_CODE.
// Both are still unsupplied as of S12.A.A4, so both links stay hidden; the
// code path exists and is correct so the owner only has to set the two env
// vars, never touch this component.
const REPLY_EMAIL = (process.env.NEXT_PUBLIC_REPLY_EMAIL ?? "").trim();
const WA_NUMBER = (process.env.NEXT_PUBLIC_WA_NUMBER ?? "").trim();

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
          {WA_NUMBER && (
            <a href={`https://wa.me/${WA_NUMBER.replace(/\D/g, "")}`} className="hover:text-white">{t("whatsapp")}</a>
          )}
        </div>
        <p className="text-xs text-px-cloud2/50">{t("copyright", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
