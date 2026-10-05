import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { publicPageHeaderRules } from "./src/lib/public-page-cache";
import { normalizeStaticBase } from "./src/lib/local-first/release/release-constants";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// AUDIT-100 B60: ONE switch moves the static files off the app origin. When NEXT_PUBLIC_PX_STATIC_BASE is an absolute http(s) URL
// (a free Cloudflare Pages project serving this build's /_next/static/**, /_release/** and public files, staged by
// scripts/stage-static-pages.mjs), every page asks THAT host for /_next/static/**. Unset (the default) = no assetPrefix, today's
// behaviour. The installer and the service worker read the same value (src/lib/local-first/release/release-constants.ts).
// ai-os/audit37/STATIC_ON_CLOUDFLARE_PAGES.md has the owner's switch and why the production default is still unset.
const STATIC_BASE = normalizeStaticBase(process.env.NEXT_PUBLIC_PX_STATIC_BASE);

const nextConfig: NextConfig = {
  ...(STATIC_BASE ? { assetPrefix: STATIC_BASE } : {}),
  /* config options here */
  // R66 code-quality fix: no recorded reason found for this. Set to false at
  // the very first scaffold commit (318a036) with no comment, and never
  // touched again in any of the 15 subsequent commits that edited this
  // file. Left as-is rather than silently re-enabling it (that changes real
  // runtime behavior -- double-invoked renders/effects in dev -- with no
  // way to verify nothing depends on the current behavior without a local
  // build, which this pass didn't have). Re-enable if no blocker turns up.
  reactStrictMode: false,
  // veridian-ui-kit ships raw .ts/.tsx source (no build step -- see that
  // repo's own package.json "exports"), so Next must transpile it like any
  // other first-party file instead of treating it as pre-built node_modules
  // output.
  transpilePackages: ["@fchecklist/veridian-ui-kit"],
  // Pin the Turbopack workspace root to this checkout. Without this, Next's
  // root-inference walks up from cwd looking for a lockfile and -- when this
  // project is checked out as a git worktree alongside the main checkout
  // (both have their own bun.lock) -- can silently pick the OTHER checkout's
  // directory as root, serving/watching its files instead of this one's.
  turbopack: {
    root: __dirname,
  },
  // R67 J-01 (audit R-246): every statically prerendered marketing document
  // -- the two public pages, one document per locale -- gets an explicit
  // shared-cache header. The list and the header value live in
  // src/lib/public-page-cache.ts so they are testable; see that file for why
  // the route list is exact rather than a pattern, and middleware.ts for why
  // none of these responses may carry a Set-Cookie.
  async headers() {
    return publicPageHeaderRules();
  },
};

export default withNextIntl(nextConfig);
