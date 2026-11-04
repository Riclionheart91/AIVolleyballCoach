-- 0097 — Eliminare definitivamente un'atleta toglie anche l'accesso dell'account collegato.
--
-- PROBLEMA
--   team_members.atleta_id ha "on delete set null" ma il vincolo team_members_atleta_id_obbligatorio
--   impone atleta_id non nullo per ruolo 'atleta': eliminare un'atleta con un account collegato falliva
--   con un errore del database (new row for relation "team_members" violates check constraint).
--
-- COSA FA
--   Prima di cancellare l'atleta elimina la riga team_members dell'account collegato (ruolo 'atleta'):
--   l'account esce dalla squadra e perde l'accesso ai suoi dati. L'account (auth.users) NON viene toccato:
--   la persona puo' essere reinvitata o appartenere ad altre squadre.
--   Vale per qualsiasi cancellazione dell'atleta (anche a cascata dalla squadra).
--
-- Rollback: in fondo (commentato).

create or replace function rimuovi_accesso_atleta_eliminata()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from team_members where atleta_id = old.id and ruolo = 'atleta';
  return old;
end;
$function$;

revoke execute on function rimuovi_accesso_atleta_eliminata() from public, anon, authenticated;

drop trigger if exists trg_rimuovi_accesso_atleta_eliminata on athletes;
create trigger trg_rimuovi_accesso_atleta_eliminata
  before delete on athletes
  for each row execute function rimuovi_accesso_atleta_eliminata();

-- ── Verifica ──
-- select tgname from pg_trigger where tgrelid = 'public.athletes'::regclass and not tgisinternal;

-- ── Rollback ──
-- drop trigger if exists trg_rimuovi_accesso_atleta_eliminata on athletes;
-- drop function if exists rimuovi_accesso_atleta_eliminata();
