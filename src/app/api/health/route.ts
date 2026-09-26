// Liveness probe for the phone-node watchdog (ops/phone-node/health.sh) and
// tunnel health checks. No auth, no database, no secrets: it only proves the
// Node process is serving requests.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, uptime_s: Math.round(process.uptime()) });
}
