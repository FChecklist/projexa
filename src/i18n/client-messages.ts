// R67 J-03 (audit R-280, landing-page transfer budget).
//
// WHAT WAS WRONG: src/app/layout.tsx handed `getMessages()` -- the ENTIRE
// message catalogue -- to <NextIntlClientProvider>. Everything passed to a
// client provider is serialised into the RSC payload of every single route,
// so all of messages/en.json (21,725 bytes; hi.json is 39,342) was shipped
// to the browser on every page load, including the two public marketing
// pages that the audit measured at 826 KB of first-load JS.
//
// Almost none of it was reachable from the client. Server Components read
// translations through `getTranslations()`, which resolves on the server and
// never touches the provider; only the handful of components that call
// `useTranslations()` need anything in the browser. On the landing page that
// is exactly two of them (MarketingHeader, ContactForm).
//
// WHY A LIST RATHER THAN "just pass Marketing": the list below is the real
// client surface, and client-messages.test.ts regenerates it from the
// filesystem in BOTH directions -- a new `useTranslations("X.y")` that is
// not covered fails the test (the namespace would silently resolve to
// nothing in the browser), and an entry here that no client component asks
// for any more fails it too (so the payload cannot quietly grow back). Same
// pattern as page-access.ts / api-write-policy.ts in this repo.
//
// Server Components are unaffected: they keep the full catalogue.

/**
 * Every namespace a `"use client"` component asks `useTranslations()` for,
 * as the exact dotted path it passes. Keep sorted; the test regenerates it.
 */
export const CLIENT_MESSAGE_NAMESPACES = [
  "Auth.login",
  "Auth.signup",
  "Marketing.contactForm",
  "Marketing.header",
  "Nav",
] as const;

export type MessageTree = { [key: string]: unknown };

function isTree(value: unknown): value is MessageTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the smallest message tree that still answers every namespace in
 * `namespaces`. A namespace that does not exist in `messages` is skipped
 * rather than throwing -- a missing translation must not take a page down,
 * and client-messages.test.ts is what proves none is missing.
 */
export function pickClientMessages(
  messages: MessageTree,
  namespaces: readonly string[] = CLIENT_MESSAGE_NAMESPACES
): MessageTree {
  const picked: MessageTree = {};

  for (const namespace of namespaces) {
    const segments = namespace.split(".");

    let source: unknown = messages;
    for (const segment of segments) {
      if (!isTree(source)) {
        source = undefined;
        break;
      }
      source = source[segment];
    }
    if (source === undefined) continue;

    let target = picked;
    for (const segment of segments.slice(0, -1)) {
      const existing = target[segment];
      const next = isTree(existing) ? existing : {};
      target[segment] = next;
      target = next;
    }
    target[segments[segments.length - 1]!] = source;
  }

  return picked;
}
