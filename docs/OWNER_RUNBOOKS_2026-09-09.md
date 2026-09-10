# Owner Runbooks 2026-09-09

Three runbooks for operationalizing R81 closure and security hardening.

## OT1: Set MINT_SECRET on Supabase Edge Function secrets

**Purpose:** Harden the Edge Function that mints demo sessions by requiring a secret.

**Steps:**

1. Log in to Supabase dashboard for project `evpckeuxgvahguwsaeul`
2. Navigate to **Edge Functions** > select the function that handles session minting
3. Click **Settings** and locate **Secrets**
4. Add a new secret:
   - Name: `MINT_SECRET`
   - Value: `<MINT_SECRET>` (replace with actual secret; do NOT commit this)
5. Save the secret
6. Redeploy the Edge Function to pick up the new secret

**Verification:**

```bash
curl -X POST https://<project>.supabase.co/functions/v1/mint-session \
  -H "Authorization: Bearer INVALID_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test"}'
```

Expected result: HTTP 401 (Unauthorized). If 200 or 500, the guard is not in place.

---

## OT2: Purge mint-session-r33 secret from git history

**Purpose:** Remove a hardcoded secret that was committed to the public repository.

**Steps:**

1. Clone or fetch the repo if not already present
2. Run git-filter-repo to remove the secret:
   ```bash
   cd /path/to/repo
   git filter-repo --invert-paths --path "path/to/file/containing/secret" \
     OR use:
   git filter-repo --replace-text '- |
       <MINT_SECRET>===>\n
       REDACTED'
   ```
3. Force-push the cleaned history:
   ```bash
   git push origin --force-with-lease main
   ```
4. Notify all collaborators to re-clone the repository:
   ```
   WARNING: Repository history has been rewritten to remove a committed secret.
   Please re-clone the repository to avoid merge conflicts:
   git clone https://github.com/FChecklist/projexa.git
   ```

**Verification:**

```bash
gh api /search/code?q="<MINT_SECRET>+repo:FChecklist/projexa"
```

Expected result: 0 hits in the repository.

---

## OT3: Rotate GitHub Personal Access Token (PAT)

**Purpose:** Invalidate the old PAT and replace it with a new one in Claude Code settings.

**Steps:**

1. Create a new fine-grained PAT in GitHub:
   - Log in to GitHub.com
   - Navigate to **Settings** > **Developer settings** > **Personal access tokens** > **Fine-grained tokens**
   - Click **Generate new token**
   - Set permissions as needed (typically: `repo`, `workflow`, `read:org`)
   - Set expiration (e.g., 90 days)
   - Generate and copy the new token

2. Update Claude Code settings:
   - Open `C:\Users\Dell\.claude\settings.json`
   - Locate the section:
     ```json
     "mcpServers": {
       "github": {
         "env": {
           "GITHUB_TOKEN": "ghp_old_token_value_here"
         }
       }
     }
     ```
   - Replace the old token with the new one:
     ```json
     "GITHUB_TOKEN": "ghp_new_token_value_here"
     ```
   - Save the file

3. Restart Claude Code to apply the change

4. Revoke the old PAT in GitHub:
   - Navigate to **Settings** > **Developer settings** > **Personal access tokens** > **Fine-grained tokens**
   - Find the old token (or identify by date)
   - Click **Delete**

**Verification:**

Test that the new token works:
```bash
gh auth status
```

Or test a request:
```bash
curl -H "Authorization: token $(grep GITHUB_TOKEN ~/.claude/settings.json | head -1)" \
  https://api.github.com/user
```

Expected result: Your GitHub user info is returned (200 OK). If 401, the token is invalid.

Test that the old token is revoked:
```bash
curl -H "Authorization: token <OLD_TOKEN>" \
  https://api.github.com/user
```

Expected result: HTTP 401 (Unauthorized).
