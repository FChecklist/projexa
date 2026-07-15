import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  // Pin the Turbopack workspace root to this checkout. Without this, Next's
  // root-inference walks up from cwd looking for a lockfile and -- when this
  // project is checked out as a git worktree alongside the main checkout
  // (both have their own bun.lock) -- can silently pick the OTHER checkout's
  // directory as root, serving/watching its files instead of this one's.
  turbopack: {
    root: __dirname,
  },
};

export default withNextIntl(nextConfig);
