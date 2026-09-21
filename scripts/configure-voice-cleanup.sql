-- OPERATOR ONLY. Do not run automatically or before configuring Vault.
-- Prerequisites: migrations through 008; deployed ai-practice; Vault secrets:
-- kelime_project_url, kelime_service_role_key, kelime_voice_cleanup_secret.
-- The last value must equal the server's AI_PRACTICE_CLEANUP_SECRET (>=32 characters).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('kelime-voice-cleanup','* * * * *',$job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='kelime_project_url') || '/functions/v1/ai-practice/cleanup',
  headers := jsonb_build_object(
   'Content-Type','application/json',
   'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='kelime_service_role_key'),
   'x-cleanup-secret',(select decrypted_secret from vault.decrypted_secrets where name='kelime_voice_cleanup_secret')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 30000
 );
$job$);
-- Verify HTTP 204 and a fresh public.ai_voice_health.checked_at before enabling voice.
-- Missing/failed cleanup leaves voice unavailable. Never grant these tables to browsers.
