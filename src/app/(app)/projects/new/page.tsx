import { requireAuth } from "@/lib/supabase/auth-guard";
import Link from "next/link";
import ProjectCreateClient from "@/components/ProjectCreateClient";

// R67 D-01 -- the real route that replaces the home screen's Create Project
// dialog (correction C-01). There is no product picker: PROJEXA projects have
// a name only, and POST /api/projects supplies VERIDIAN's required productId.
// A page component may only return JSX: Next's generated route types reject a
// NextResponse here, which is why `return ctx.response` compiled under
// `tsc --noEmit` and still failed `next build`. Every other page in this app
// (see dashboard/page.tsx) reads the context and returns nothing else --
// redirecting an unauthenticated visitor is the proxy's job, over the
// protected-route list scripts/generate-protected-routes.mjs emits.
export default async function NewProjectPage() {
  await requireAuth();

  return (
    <div className="flex-1">
      {/* PROJEXA-BUILD-002 WP-10: the way in for a person who has a workbook rather than a form to fill. */}
      <p className="px-6 pt-4 text-sm text-muted-foreground">
        Have a workbook with the BOQ? <Link className="underline" href="/projects/from-file">Make a project from a file</Link> instead of typing it in.
      </p>
      <ProjectCreateClient />
    </div>
  );
}
