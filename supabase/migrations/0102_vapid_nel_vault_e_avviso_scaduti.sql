-- 0102 — Chiave privata delle notifiche push nel Vault + giro quotidiano sui certificati scaduti.
--
-- 1. La chiave privata VAPID (che firma le notifiche push) vive nel Vault del database, non in un secret da
--    copiare a mano: la genera l'edge function genera-vapid e la leggono le funzioni che inviano le notifiche
--    con la chiave di servizio. Nessuno deve mai vederla. Se esiste anche il secret VAPID_PRIVATE_JWK della
--    funzione, ha la precedenza.
-- 2. Un certificato medico gia' scaduto viene notificato ogni giorno (push): job quotidiano che chiama
--    notifica-certificati con {"solo_scaduti": true}. Quelli in scadenza restano al venerdi' (job esistente).

create or replace function leggi_vapid_privata()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_jwk' limit 1;
$$;

-- Salva la chiave solo se non c'e' gia': non si sovrascrive mai (cambiarla invaliderebbe tutti gli abbonamenti).
create or replace function salva_vapid_privata(p_jwk text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from vault.secrets where name = 'vapid_private_jwk') then
    return false;
  end if;
  perform vault.create_secret(p_jwk, 'vapid_private_jwk');
  return true;
end;
$$;

revoke execute on function leggi_vapid_privata() from public, anon, authenticated;
revoke execute on function salva_vapid_privata(text) from public, anon, authenticated;
grant execute on function leggi_vapid_privata() to service_role;
grant execute on function salva_vapid_privata(text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notifica_certificati_scaduti_giornaliero') then
    perform cron.unschedule('notifica_certificati_scaduti_giornaliero');
  end if;

  -- Ogni giorno tranne il venerdi' (c'e' gia' il giro completo): 06:30 UTC = 07:30/08:30 in Italia.
  perform cron.schedule(
    'notifica_certificati_scaduti_giornaliero',
    '30 6 * * 0-4,6',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'certificati_project_url') || '/functions/v1/notifica-certificati',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'certificati_publishable_key')
      ),
      body := '{"solo_scaduti": true}'::jsonb
    ) as request_id;
    $cron$
  );
exception when others then
  raise warning 'Job notifica_certificati_scaduti_giornaliero non creato: %', sqlerrm;
end $$;

-- ── Rollback ──
-- select cron.unschedule('notifica_certificati_scaduti_giornaliero');
-- drop function if exists salva_vapid_privata(text);
-- drop function if exists leggi_vapid_privata();
-- delete from vault.secrets where name = 'vapid_private_jwk';
