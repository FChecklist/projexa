# Turning on "Continue with Google" (owner steps)

The login page already has the code for a "Continue with Google" button. It stays hidden until Google is switched on in Supabase, then it appears by itself. The e-mail + 6-digit-code way of signing in stays the main way; Google is an extra.

You do these three things once. Nothing needs changing in the code.

## 1. Create the Google key (Google Cloud console)

1. Open the Google Cloud console, choose or create a project.
2. APIs & Services, then OAuth consent screen: fill in the app name and your support e-mail. The basic scopes are enough: e-mail, profile, openid.
3. APIs & Services, then Credentials, then Create credentials, then OAuth client ID. Type: **Web application**.
4. Under "Authorised redirect URIs" add exactly:
   `https://evpckeuxgvahguwsaeul.supabase.co/auth/v1/callback`
   (this is the PROJEXA Supabase project).
5. Save. Google shows a **Client ID** and a **Client secret**. Keep them for step 2.

## 2. Switch Google on (Supabase dashboard)

1. Open the PROJEXA project, then Authentication, then Providers, then Google.
2. Paste the Client ID and the Client secret, and turn Google on. Save.

## 3. Check the return address

Authentication, then URL Configuration: make sure `https://projexa-ai.com/auth/callback` is allowed. It already is in the current configuration, so this is only a quick look.

## What happens next

- Reload the login page: the "Continue with Google" button now shows (it is hidden offline and whenever Google is off).
- Someone who first signed in with an e-mail code and later uses Google with the **same e-mail address** lands in the **same account**. Supabase joins them by the verified e-mail; there is no second account.
- If a person cancels at Google, they see one plain sentence and can use the e-mail code instead.

## Important

An agent (any AI assistant) must **never** enter, paste, store or read the Client ID or Client secret. Only you type them into the Google and Supabase pages above. They must not be put in the code, in `.env` files, in chat or in these documents.
