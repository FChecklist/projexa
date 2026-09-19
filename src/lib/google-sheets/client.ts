import { google } from "googleapis";

// A single PROJEXA-owned Google service account creates and owns every
// org's spreadsheet (Editor access is then shared out to that org's real
// members -- see spreadsheet-builder.ts). There is no per-org Google OAuth
// token to manage; the only per-org state is which spreadsheet belongs to
// which org (see googleSheetsIntegration in src/lib/db/schema.ts).
//
// GOOGLE_SERVICE_ACCOUNT_JSON holds the full downloaded service-account key
// file contents as a single-line JSON string (the standard shape Google's
// own docs recommend for env-var storage: `JSON.stringify(keyFile)`).
// Lazy + memoized so importing this module never throws for a request path
// that doesn't touch Google Sheets, matching src/lib/db/index.ts's own
// lazy-connection convention for the same reason.

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

type ServiceAccountKey = { client_email: string; private_key: string };

let cachedAuth: InstanceType<typeof google.auth.JWT> | null = null;

function getServiceAccountKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set. Add the Google Cloud service account key (downloaded JSON, minified to one line) to .env.local."
    );
  }
  let parsed: Partial<ServiceAccountKey>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

function getAuth() {
  if (!cachedAuth) {
    const key = getServiceAccountKey();
    cachedAuth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: SCOPES,
    });
  }
  return cachedAuth;
}

export function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

export function getDriveClient() {
  return google.drive({ version: "v3", auth: getAuth() });
}

export function getServiceAccountEmail(): string {
  return getServiceAccountKey().client_email;
}
