import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { pickClientMessages, type MessageTree } from "@/i18n/client-messages";
import type { SupportedLocale } from "@/i18n/locales";

// R67 J-01 fix pass (audit R-246). The CLIENT half of a per-locale marketing
// document.
//
// The Server Components on these pages take an explicit `locale` prop (see
// ./marketing-locale). The two client components on them -- MarketingHeader
// and ContactForm -- read their strings from <NextIntlClientProvider>, which
// src/app/layout.tsx mounts once for the whole app using the ambient locale.
// On a statically prerendered route the ambient locale is always the default
// one, so without this the Hindi document would render Hindi sections with an
// English header and an English contact form.
//
// Nesting a provider overrides locale + messages for its subtree and nothing
// else, so every authenticated route keeps the app-wide provider exactly as
// it was. It carries the same pickClientMessages() subset the root layout
// does (J-03's payload budget), not the whole catalogue.
export async function MarketingLocaleProvider({
  locale,
  children,
}: {
  locale: SupportedLocale;
  children: ReactNode;
}) {
  const messages = pickClientMessages((await loadMessages(locale)) as MessageTree);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
