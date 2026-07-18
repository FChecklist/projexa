import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { veridianHeadingFont } from "@fchecklist/veridian-ui-kit/tokens/fonts";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

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

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} ${veridianHeadingFont.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
            {children}
          </ThemeProvider>
          <Toaster position="top-right" richColors />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
