import { afterEach, describe, expect, test } from "bun:test";

// next.config.ts is evaluated at import time, so each case re-imports it with a
// cache-busting query after setting the env var.
async function loadConfig(flag: string | undefined) {
  if (flag === undefined) delete process.env.PHONE_NODE_BUILD;
  else process.env.PHONE_NODE_BUILD = flag;
  const mod = await import(`../../next.config.ts?flag=${String(flag)}-${Math.random()}`);
  return mod.default as { output?: string; images?: { unoptimized?: boolean } };
}

describe("phone-node build setting", () => {
  const saved = process.env.PHONE_NODE_BUILD;
  afterEach(() => {
    if (saved === undefined) delete process.env.PHONE_NODE_BUILD;
    else process.env.PHONE_NODE_BUILD = saved;
  });

  test("default build is unchanged (no standalone output, images untouched)", async () => {
    const cfg = await loadConfig(undefined);
    expect(cfg.output).toBeUndefined();
    expect(cfg.images).toBeUndefined();
  });

  test("PHONE_NODE_BUILD=1 emits standalone output with unoptimized images", async () => {
    const cfg = await loadConfig("1");
    expect(cfg.output).toBe("standalone");
    expect(cfg.images?.unoptimized).toBe(true);
  });

  test("any other value leaves the build unchanged", async () => {
    const cfg = await loadConfig("0");
    expect(cfg.output).toBeUndefined();
  });
});
