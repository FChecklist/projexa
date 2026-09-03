import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { veridianHeadingFont } from "@fchecklist/veridian-ui-kit/tokens/fonts";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { pickClientMessages, type MessageTree } from "@/i18n/client-messages";
import "./globals.css";

// R67 J-01 (audit R-246) checked the font half of that item against the
// real build rather than changing it on principle, and found nothing to
// change:
//   - all three faces are next/font/google, which downloads them at BUILD
//     time and serves them from this origin's /_next/static/media. No font
//     request ever leaves this origin, so there is deliberately NO
//     <link rel="preconnect"> to fonts.gstatic.com here: a preconnect to a
//     host we never contact is a wasted connection, not an optimisation.
//     (The item's wording assumes a CDN <link>, which this app has not used
//     since the 2026-07-17 redesign.)
//   - all three already declare `display: "swap"`, and all three name a
//     `subsets` list, which is the condition under which next/font preloads
//     a face. The prerendered "/" document references exactly three woff2
//     files (17.4 + 39.5 + 47.3 KB), one per family, and preloads all three
//     -- correct, since all three render above the fold (body copy, the h1,
//     and the mono eyebrow/stat chips).
//   - the kit's tokens/fonts module also declares a second, unused Inter
//     (`veridianSansFont`; this repo binds --font-sans to its own
//     --font-inter instead). Measured before/after: Turbopack tree-shakes
//     it, the prerendered document preloads three faces either way, and
//     replacing the kit import with a local DM_Serif_Display() call changed
//     the transferred bytes by zero. So the kit import STAYS -- see the
//     directive below, which is a real reason to keep it, against a
//     measured benefit of nothing.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Owner directive 2026-07-18: heading font must exactly match VERIDIAN AI
// OS's (DM Serif Display) -- replaces the previous PROJEXA-only Space
// Grotesk choice. Loaded from the shared veridian-ui-kit package (not a
// local next/font/google call) so every consuming product loads the
// literal same font instance/variable name.

// Marketing site redesign (2026-07-17): small monospace eyebrow/tag labels
// (e.g. the hero badge, catalog category tags) -- self-hosted the same way
// as Inter/Space Grotesk above, not a Google Fonts CDN <link>.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PROJEXA — Construction Intelligence AI OS",
  description:
    "PROJEXA digitizes the full construction execution lifecycle -- scope, drawings, budgets, vendors, manpower, daily site progress, and reporting -- with AI-native decision support, built on VERIDIAN AI OS.",
  icons: { icon: "/favicon.ico" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // PLATFORM-01 Wave 2 (Workstream 5, i18n): locale comes from the cookie
  // middleware.ts sets (see src/i18n/request.ts) -- no [locale] URL segment
  // exists in this app, so <html lang> is set from the resolved locale here
  // rather than from a route param.
  const locale = await getLocale();
  const messages = await getMessages();

  // R67 J-03 (audit R-280): this used to hand the ENTIRE catalogue to the
  // client provider, which serialises it into the RSC payload of every
  // route -- all 21,725 bytes of messages/en.json (39,342 of hi.json) in
  // every page load, when the only things that can read it in the browser
  // are the six components that call useTranslations(). Server Components
  // resolve through getTranslations() and never touch the provider, so they
  // are unaffected. See src/i18n/client-messages.ts, and
  // client-messages.test.ts for the drift guard that regenerates the
  // namespace list from the filesystem in both directions.
  const clientMessages = pickClientMessages(messages as MessageTree);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} ${veridianHeadingFont.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <NextIntlClientProvider locale={locale} messages={clientMessages}>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
            {children}
          </ThemeProvider>
          <Toaster position="top-right" richColors />
          <ServiceWorkerRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
