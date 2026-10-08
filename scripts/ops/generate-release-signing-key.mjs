// Generates the release-signing keypair (ES256 / P-256): the PRIVATE key goes ONLY to the file given with --out (PEM, never printed),
// the PUBLIC key is printed as a JWK plus its sha256 fingerprint. Refuses to overwrite an existing key file.
// Usage: node scripts/ops/generate-release-signing-key.mjs --out <path>\release-signing-private.pem [--kid <kid>]
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const out = arg("out");
if (!out) throw new Error("--out <private key file> is required");
if (existsSync(out)) throw new Error(`${out} already exists: refusing to overwrite a signing key`);
const kid = arg("kid") ?? `px-release-${new Date().toISOString().slice(0, 10)}`;
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
const jwk = publicKey.export({ format: "jwk" });
const fingerprint = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
console.log(JSON.stringify({ kid, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, public_key_sha256: fingerprint, private_key_file: out }, null, 2));
