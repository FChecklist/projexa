// PROJEXA-BUILD-001 U-33. The two switches of the browser-first BOQ screen, read from the SERVER's environment once per request by
// src/app/(app)/scope/[id]/page.tsx and handed to the client component as a plain prop (a client bundle cannot read an environment
// variable that does not start with NEXT_PUBLIC_, and these names are fixed by PROJEXA-BUILD-001).
//
//   BUILD001_BOQ_READ_VIA_GATEWAY   the screen reads its line items from the Edge gateway instead of the /api/scope proxy.
//   BUILD001_BOQ_BROWSER_FIRST      the lines are also kept on the device, and the project line search runs in a Web Worker.
//
// Both default OFF. Only the exact text "true" or "1" turns one on, so a typo leaves the screen on the existing read path. The second
// switch does nothing without the first: the device copy and the search index are built from the gateway's project-wide pages, which
// the /api/scope proxy has no equivalent of.

export type BoqReadFlags = {
  viaGateway: boolean
  browserFirst: boolean
}

export const BOQ_READ_FLAGS_OFF: BoqReadFlags = { viaGateway: false, browserFirst: false }

function isOn(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase()
  return v === "true" || v === "1"
}

export function readBoqReadFlags(env: Record<string, string | undefined> = process.env): BoqReadFlags {
  const viaGateway = isOn(env.BUILD001_BOQ_READ_VIA_GATEWAY)
  return { viaGateway, browserFirst: viaGateway && isOn(env.BUILD001_BOQ_BROWSER_FIRST) }
}
