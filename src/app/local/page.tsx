// LOCAL-FIRST: the static on-laptop shell, /local. One prerendered document with NO server data -- no cookies, no headers, no database,
// no Supabase server client -- so it can be cached in the browser by the service worker and opened with no network at all. WHO is
// signed in comes from the identity kept on the laptop; WHAT is shown comes from the laptop's own database
// (src/lib/local-first/shell). /local/[...path] (next to this file) is the same document for every sub-path.
//
// Pinned by src/app/local/local-shell-static.test.ts: force-static, nothing read from the request, and an import graph with no server module.
import LocalShellEntry from "@/components/local-first/LocalShellEntry";

export const dynamic = "force-static";

export const metadata = { title: "PROJEXA", robots: { index: false, follow: false } };

export default function LocalShellPage() {
  return <LocalShellEntry />;
}
