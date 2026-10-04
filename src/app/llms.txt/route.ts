// LOCAL-FIRST browser AI (R5, R11): the manual in plain words at /llms.txt (the llms.txt convention an AI looks for).
// STATIC (force-static) and free of personal data, exactly like /ai-manual.json; see src/lib/local-first/ai/manual.ts.
import { buildManual, manualText } from "@/lib/local-first/ai/manual";

export const dynamic = "force-static";

export function GET() {
  return new Response(manualText(buildManual()), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
