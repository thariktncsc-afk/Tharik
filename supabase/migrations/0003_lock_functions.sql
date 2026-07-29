-- SECURITY FIX — run immediately after 0002_users.sql.
--
-- 0002 created verify_login() and set_user_password() as `security definer` and
-- tried to lock them with:
--     revoke all on function ... from anon, authenticated;
--
-- That is not enough. PostgreSQL grants EXECUTE on every new function to PUBLIC
-- by default, and `anon` inherits it through PUBLIC — so revoking from the role
-- by name left the grant intact. Both functions were reachable by anyone
-- holding the publishable key, which ships to every browser:
--
--   verify_login()       — offline password guessing straight against the
--                          database, bypassing the API, with no rate limiting
--                          and nothing written to the audit trail.
--   set_user_password()  — set any user's password without authenticating.
--                          Full account takeover, including the administrator.
--
-- The fix is to revoke from PUBLIC first, then grant back only to the role the
-- API actually uses.

revoke all on function public.verify_login(text, text)        from public;
revoke all on function public.set_user_password(bigint, text)  from public;

revoke all on function public.verify_login(text, text)        from anon, authenticated;
revoke all on function public.set_user_password(bigint, text)  from anon, authenticated;

grant execute on function public.verify_login(text, text)       to service_role;
grant execute on function public.set_user_password(bigint, text) to service_role;

-- Same trap applies to anything added later: `security definer` plus the default
-- PUBLIC grant means the function is world-callable unless PUBLIC is revoked.
-- Revoke from PUBLIC by default for functions created in this schema from here on.
alter default privileges in schema public revoke execute on functions from public;
