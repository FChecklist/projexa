// AUDIT-100 B10. A stand-in for the ONE VERIDIAN read the new-project page makes on the SERVER (src/app/(app)/projects/new/page.tsx ->
// callVeridian("/products")), used only by playwright.local-first.config.ts. That read runs inside `next start`, so the browser-side
// page.route stubs cannot answer it, and without it the product picker is empty and "Save" stays disabled: no project could ever be made
// in the rig. Every other path answers 404 (exactly what a page that asks for something else got before: an error, never data).
//   * the app reaches it through VERIDIAN_API_BASE_URL with a placeholder VERIDIAN_API_KEY (the rig's requireAuth finds no membership,
//     so callVeridian uses the shared-key path; the key is checked here so a call without it is refused like the real API would);
//   * it listens on loopback only and knows nothing real: the product is made up.
import { createServer } from "node:http"

const PORT = Number(process.env.FAKE_VERIDIAN_PORT ?? 54398)
const KEY = process.env.FAKE_VERIDIAN_KEY ?? "local-stub-veridian-key"
const PRODUCTS = [{ id: "lf-product-fitout", name: "Interior Fit-out (local stand-in)" }]

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`)
  if (url.pathname === "/health") return json(res, 200, { ok: true })
  if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: "Unauthorized" })
  if (req.method === "GET" && url.pathname === "/products") return json(res, 200, { products: PRODUCTS })
  return json(res, 404, { error: "not part of the local VERIDIAN stand-in" })
})

server.listen(PORT, "localhost", () => {
  console.log(`local VERIDIAN stand-in listening on http://localhost:${PORT}`)
})
