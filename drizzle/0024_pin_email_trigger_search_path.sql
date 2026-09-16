-- Supabase security advisor (function_search_path_mutable): the BEFORE INSERT
-- trigger function that enforces email_action_token's org-match boundary
-- (check_email_action_token_org_match, drizzle/0023_ai_link_and_email.sql)
-- had no pinned search_path, making it theoretically susceptible to a
-- search_path-hijack (a malicious object earlier in the caller's search_path
-- shadowing an unqualified name the function resolves). The function's own
-- body already schema-qualifies every reference, so this closes the class of
-- risk without changing any behavior -- purely additive, applied live via
-- Supabase MCP (name: pin_email_trigger_search_path).
ALTER FUNCTION public.check_email_action_token_org_match() SET search_path = public;
