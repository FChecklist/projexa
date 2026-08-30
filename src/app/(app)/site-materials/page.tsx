import { redirect } from "next/navigation";

// Real-screen conversion (2026-08-30): /site-materials's "Catalog" tab was
// this same constructionMaterials table under a different label than
// /materials, and its "Inbound"/"Cost Report" tabs called VERIDIAN paths
// that never existed on the other side (confirmed against ct's own route
// tree -- no /construction/materials/inbound, no .../cost-report existed
// before this conversion), so both tabs always failed. Rather than maintain
// two screen sets for one real entity -- the same "same entity, reuse the
// Object Page" call this session already made for Purchase Orders (module
// #24, which reuses Procurement's PO Object Page) -- this route now
// redirects to the one real Materials screen (which gained a real,
// backend-verified Cost Report tab as part of this same conversion). The
// nav entry itself stays put (nav-routes.test.ts asserts /site-materials
// specifically stays in the sidebar), it just lands on real, working data
// instead of two dead tabs.
export default async function SiteMaterialsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  redirect(projectId ? `/materials?projectId=${encodeURIComponent(projectId)}` : "/materials");
}
