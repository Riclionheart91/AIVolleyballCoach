-- 0094 — Revoca delle sessioni quando la password di un account viene reimpostata
--
-- Dopo un reset (o un primo invito su un account che esisteva gia') la password nuova vale da subito, ma chi
-- aveva gia' una sessione aperta (per esempio un telefono perso) resterebbe dentro. La edge function
-- `attiva-accesso` chiama questa funzione con la service role, DOPO aver impostato la password e collegato il
-- link, solo quando la password di un account GIA' ESISTENTE viene cambiata.
--
-- Non e' richiamabile da anon ne' da utenti autenticati.

create or replace function revoca_sessioni_utente(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if p_user_id is null then return; end if;
  -- Le sessioni hanno i refresh token in cascata; si eliminano comunque anche i token rimasti per sicurezza.
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
end;
$$;

revoke execute on function revoca_sessioni_utente(uuid) from public, anon, authenticated;
grant execute on function revoca_sessioni_utente(uuid) to service_role;

-- ==========================================================================================================
-- VERIFICHE MANUALI (dopo l'applicazione; non fanno parte della migrazione)
-- ==========================================================================================================
--  1. select proname, proacl from pg_proc where proname = 'revoca_sessioni_utente';
--     -> solo postgres e service_role.
--  2. Con un utente di prova: accedere da due browser, reimpostare la password tramite link, verificare che
--     il browser rimasto aperto venga disconnesso al rinnovo del token.
--
-- ROLLBACK
--   drop function if exists revoca_sessioni_utente(uuid);
