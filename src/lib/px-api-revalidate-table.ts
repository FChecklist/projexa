// Pure data (no imports): the page-side cache entries a write clears, shared by the browser switch (src/lib/px-api.ts) and the one Vercel route that clears them
// (src/app/api/cache/revalidate/route.ts). Kept apart from px-api.ts so the ROUTE does not pull the browser Supabase client into a server bundle.

/** AUDIT-100 A2 batch 7: the page-side cache entries a write clears. The Next write handlers call revalidateTag / revalidatePath so a new row shows at
 *  once on the server-rendered list; a function on Supabase cannot, so after the edge answered a write the browser asks Vercel's one small route
 *  (src/app/api/cache/revalidate/route.ts) to clear the same entries. Equal to `revalidate` in ai-os/audit37/projexa-api-routes.json, which
 *  src/lib/projexa-api-edge.test.ts holds equal to what the REAL Next handlers cleared in the recorded parity contract. `when`: "success" (a 2xx
 *  answer, the default) or "always" (the handler clears before it calls the backend: /api/projects). */
export type PxRevalidate = { tags: readonly string[]; paths?: readonly string[]; when?: "success" | "always" };
export const PX_EDGE_REVALIDATE: Readonly<Record<string, PxRevalidate>> = {
  "POST /api/documents": { tags: ["module:documents"] },
  "POST /api/drawings": { tags: ["module:drawings"] },
  "POST /api/permits": { tags: ["module:permits"] },
  "POST /api/labour-roster": { tags: ["module:manpower"] },
  "POST /api/materials/master": { tags: ["module:materials"] },
  "POST /api/meetings": { tags: ["module:meetings"] },
  "POST /api/moms": { tags: ["module:moms"] },
  "POST /api/mood-boards": { tags: ["module:mood-boards"] },
  "POST /api/knowledge-base": { tags: ["knowledge-base"] },
  "PATCH /api/knowledge-base/:id": { tags: ["knowledge-base"] },
  "POST /api/projects": { tags: ["projects"], when: "always" },
  "POST /api/scope": { tags: ["module:scope"], paths: ["/scope"] },
};
/** What /api/cache/revalidate will clear: the union of the table above (nothing else). */
export const PX_REVALIDATABLE: { tags: readonly string[]; paths: readonly string[] } = {
  tags: [...new Set(Object.values(PX_EDGE_REVALIDATE).flatMap((r) => r.tags))],
  paths: [...new Set(Object.values(PX_EDGE_REVALIDATE).flatMap((r) => r.paths ?? []))],
};
