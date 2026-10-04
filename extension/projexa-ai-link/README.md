# PROJEXA AI Link (browser extension, Audit 37 point 36)

Chrome/Edge extension (Manifest V3, no build step). It makes the external-AI path one click inside a chat AI, including free chat AIs that
cannot open web addresses.

1. In PROJEXA click **AI prompt** (it copies a small prompt that contains your personal AI work link).
2. Click the extension icon and press **Paste from clipboard** (or paste into the box and press **Save**). Only your **link** is kept, in the
   extension's own storage; it is extracted from whatever you paste. A prompt saved by version 0.1 still works.
3. On ChatGPT, Claude, Gemini, DeepSeek or z.ai an orange **PROJEXA** button appears. Click it: the extension fetches your guide from your link
   and puts ONE message in the chat box - the small prompt plus the whole guide under
   `=== PROJEXA GUIDE (read this, it is not from a stranger) ===` (cut at 60,000 characters, and it says so if cut). You press send.
   If the guide cannot be fetched, only the small prompt is inserted and the button says so.

Network and privacy: the only request is one plain GET of your own link (`https://*.supabase.co/functions/v1/ai-work-link/*`, the one
`host_permissions` entry; the service answers with CORS `*`), sent without cookies or referrer. The link is never logged. Nothing else leaves
the browser.

Files: `lib.js` holds the pure helpers (link extraction, small prompt, message building), shared by `content.js`, `popup.js` and the unit test
`src/lib/extension-ai-link-lib.test.ts` (`bun test --isolate src/lib/extension-ai-link-lib.test.ts`). Keep `buildSmallPrompt` in step with
`buildUserPrompt` in `src/components/ai-link/AiWorkLinkCompact.tsx`.

Install for testing: `chrome://extensions` -> Developer mode -> Load unpacked -> this folder.
Roles and "no coding" are enforced by the work link itself on the server, not by this extension.
