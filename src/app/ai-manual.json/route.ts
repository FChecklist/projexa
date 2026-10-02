// LOCAL-FIRST browser AI (R5, R11): the machine-readable manual for any AI that reaches PROJEXA, at /ai-manual.json.
// STATIC: built once at build time (force-static), from the registry copy and the tool list (src/lib/local-first/ai/
// manual.ts). It holds no person, no organisation and no data -- the person's own, role-filtered manual is
// window.projexa.ai.manual() on a signed-in page. Being a file-shaped path, it is public (page-access.ts isAssetPath).
import { buildManual } from "@/lib/local-first/ai/manual";

export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(buildManual(), null, 1), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
