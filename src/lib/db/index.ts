import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Prefer DATABASE_URL; fall back to building the transaction-pooler URL from
// Supabase env vars. Same pattern as VERIDIAN's src/lib/db/index.ts -- this
// project's Supabase region is also ap-south-1.
function getConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (supabaseUrl && dbPassword) {
    const ref = supabaseUrl.replace("https://", "").split(".")[0];
    return `postgresql://postgres.${ref}:${dbPassword}@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`;
  }

  throw new Error("No database connection string available. Set DATABASE_URL or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD.");
}

// Lazy: importing this module must not require DATABASE_URL to be set --
// most PROJEXA requests (the demo single-tenant stub) never touch this DB.
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!_db) {
    const client = postgres(getConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof drizzle<typeof schema>>];
  },
});

export * from "./schema";
