# PROJEXA connector: directory submission packet (2026-10-07)

What PROJEXA offers to AI tools, what is already built and tested, and what only the owner can do. Written for a non-technical reader first.

## What is live (built and tested)

| Piece | Address | Proof |
|---|---|---|
| The MCP server AI tools talk to | `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-oauth/mcp` | Live: no sign-in answers 401 with the pointer to the sign-in rules; a signed-in call returns the 12 tools |
| "Sign in with PROJEXA" (OAuth 2.1, PKCE S256, dynamic client registration) | metadata at `https://projexa-ai.com/.well-known/oauth-authorization-server` | `compliance-tracker` `src/lib/ai-links/projexa-oauth.test.ts` (14 tests, falsifiability checked); live end-to-end run 2026-10-07 |
| The consent page the person sees (Allow / Not now) | `https://projexa-ai.com/connect/authorize/<request>` | `src/app/(app)/connect/authorize/[payload]/ConnectAuthorizeClient.test.tsx` (7 tests) |
| Setup guide for users | `https://projexa-ai.com/connect-ai.html` | static page |
| Tool safety labels | all 12 tools carry `readOnlyHint`/`destructiveHint`; every tool has a human title | live `tools/list` |

What the connection can do is decided by the existing PROJEXA AI work link: by default level 0 (read, check and prepare changes; the person confirms each one in PROJEXA); the person can tick a box on the Allow page for level 1 (direct add, edit and delete). Always limited to the person's own role. The OAuth access token IS that work link, valid 30 days; the person can revoke it in AI link settings.

## Submit to the Claude connector directory (owner)

1. Needs a Claude **Team or Enterprise** organisation and directory-management access (Claude.ai admin settings, connectors submission portal).
2. Provide: the MCP address above, a name ("PROJEXA"), a description (below), a **privacy policy URL**, and setup instructions (link `connect-ai.html`).
3. Provide a **test account with dummy data**: the demo organisation account (the owner holds its login; never put it in a repo).
4. Anthropic requires OAuth 2.0 for authenticated servers (done) and a title plus read-only/destructive hint on every tool (done).

## Submit to the ChatGPT app directory (owner)

1. Test it first in ChatGPT **Developer mode**: Settings, Apps, add the MCP address, choose OAuth.
2. Submit for review with: connection details (the address), testing instructions (the demo account), directory description and the countries it is offered in.

## Owner-only items before submitting

- **Privacy policy page.** PROJEXA has `/disclaimer` but no privacy policy page. Both directories ask for one. It needs the owner's text (legal wording is not for an AI to invent).
- **The demo account's login** for the reviewers.
- **The directory accounts** themselves (Claude Team/Enterprise admin; OpenAI developer account) and any fees or verification they ask for.
- **Gemini** has no one-click directory for custom servers yet; users paste the address (see the guide).

## Description to paste (short, plain)

PROJEXA is construction project management software. Connect it to your AI assistant to read your projects, tasks, budgets and documents, and to prepare changes that you confirm inside PROJEXA (or, if you choose, let it make changes directly). It sees only what your own role allows.

## Known limits

- The sign-in lasts 30 days; there is no refresh token, so the AI tool asks the person to Allow again after that.
- Every AI tool that connects acts as the person who allowed it; PROJEXA shows each connection as a link in AI link settings so it can be revoked.
