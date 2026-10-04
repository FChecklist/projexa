// LOCAL-FIRST: /local/<anything>. The same static shell as ../page.tsx; the client router draws the screen for the address. Kept as its
// own catch-all page (not an optional [[...path]]) so that /local itself stays an exact, separately listed public route
// (src/lib/authz/page-access.ts) and src/lib/authz/page-access.test.ts can check it against the filesystem.
import LocalShellEntry from "@/components/local-first/LocalShellEntry";

export const dynamic = "force-static";

export const metadata = { title: "PROJEXA", robots: { index: false, follow: false } };

export default function LocalShellCatchAllPage() {
  return <LocalShellEntry />;
}
