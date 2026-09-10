// P2.3 (W-ENV, R81-ADDENDUM-B phase S5): loaded ONLY via bunfig.toml's
// `[test] preload`, before any test file runs. This is the actual
// enforcement point -- see test-guard.ts for the check itself and why it
// exists. Nothing else should import this file; import
// { assertTestDatabase } from "./test-guard" instead if you need the check
// itself (e.g. in a test).
import { assertTestDatabase } from "./test-guard";

assertTestDatabase(process.env.DATABASE_URL);
