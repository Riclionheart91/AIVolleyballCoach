-- 0103 — Archiviare un'atleta le toglie l'accesso all'app (come gia' succede con l'eliminazione, vedi 0097).
--
-- COSA FA
--   Quando athletes.status passa a 'archiviata':
--     - elimina la riga team_members dell'account collegato (ruolo 'atleta'): l'account esce dalla squadra;
--     - annulla gli inviti in sospeso (team_invites) e i link di accesso non ancora usati (link_accesso) di quell'atleta.
--   L'account (auth.users) non viene toccato: se l'atleta torna in rosa (ripristino) va reinvitata.
--   I dati dell'atleta (valutazioni, presenze, scout...) restano: archiviare non cancella nulla.
--   Ripristinare l'atleta NON restituisce l'accesso da solo.
--
-- Pulizia una tantum: stessa cosa per le atlete gia' archiviate (oggi nessuna ha accessi o inviti: nessun effetto).
-- Rollback: in fondo (commentato).

create or replace function rimuovi_accesso_atleta_archiviata()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'archiviata' and old.status is distinct from 'archiviata' then
    delete from team_members where atleta_id = new.id and ruolo = 'atleta';
    delete from team_invites where atleta_id = new.id;
    delete from link_accesso where atleta_id = new.id and usato_il is null;
  end if;
  return new;
end;
$function$;

revoke execute on function rimuovi_accesso_atleta_archiviata() from public, anon, authenticated;

drop trigger if exists trg_rimuovi_accesso_atleta_archiviata on athletes;
create trigger trg_rimuovi_accesso_atleta_archiviata
  after update of status on athletes
  for each row execute function rimuovi_accesso_atleta_archiviata();

-- Pulizia una tantum per le atlete gia' archiviate.
delete from team_members m using athletes a where m.atleta_id = a.id and m.ruolo = 'atleta' and a.status = 'archiviata';
delete from team_invites i using athletes a where i.atleta_id = a.id and a.status = 'archiviata';
delete from link_accesso l using athletes a where l.atleta_id = a.id and l.usato_il is null and a.status = 'archiviata';

-- ── Verifica ──
-- select tgname from pg_trigger where tgrelid = 'public.athletes'::regclass and not tgisinternal;

-- ── Rollback ──
-- drop trigger if exists trg_rimuovi_accesso_atleta_archiviata on athletes;
-- drop function if exists rimuovi_accesso_atleta_archiviata();
