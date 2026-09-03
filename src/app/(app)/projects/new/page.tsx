import { requireAuth } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError, VERIDIAN_SCREEN_BUDGET_MS } from "@/lib/veridian-client";
import ProjectCreateClient, { type ProductOption } from "@/components/ProjectCreateClient";

// R67 D-01 -- the real route that replaces the home screen's Create Project
// dialog (correction C-01). Decision D-04, Option A: the product list is read
// HERE, in the server component, so the org's VERIDIAN API key never reaches
// the browser and the create screen renders with its picker already filled.
// The read is bounded by the shared screen budget so a hung upstream costs
// this screen 8 s, not the whole function timeout.
// A page component may only return JSX: Next's generated route types reject a
// NextResponse here, which is why `return ctx.response` compiled under
// `tsc --noEmit` and still failed `next build`. Every other page in this app
// (see dashboard/page.tsx) reads the context and returns nothing else --
// redirecting an unauthenticated visitor is the proxy's job, over the
// protected-route list scripts/generate-protected-routes.mjs emits.
export default async function NewProjectPage() {
  const ctx = await requireAuth();

  let products: ProductOption[] = [];
  let productsError: string | null = null;
  try {
    const data = await callVeridian<{ products: ProductOption[] }>("/products", {
      organizationId: ctx.organizationId ?? undefined,
      timeoutMs: VERIDIAN_SCREEN_BUDGET_MS,
    });
    products = data.products ?? [];
  } catch (err) {
    // The backend's own words, never a generic sentence -- and never an empty
    // picker presented as "this org has no products".
    productsError = err instanceof VeridianApiError ? err.message : "the request did not complete";
  }

  return (
    <div className="flex-1">
      <ProjectCreateClient products={products} productsError={productsError} />
    </div>
  );
}
