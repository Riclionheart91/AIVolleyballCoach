-- 0037 — Scout come permesso separato + visione live per gli atleti
--
-- PROBLEMA: "scout" era un ruolo alternativo, quindi assegnarlo a una
-- giocatrice le avrebbe tolto il profilo atleta (e la scheda
-- collegata). Diventa un PERMESSO indipendente dal ruolo, assegnabile
-- e revocabile a chiunque.
--
-- VISIONE LIVE: durante la partita tutti i membri seguono l'andamento
-- in tempo reale; a partita conclusa ciascun atleta torna a vedere
-- solo le proprie azioni.
--
-- (v2: elenca_membri_team va eliminata prima di essere ricreata con
-- forma diversa, perché Postgres non lo consente con CREATE OR REPLACE
-- quando cambiano le colonne del risultato — la v1 di questa
-- migrazione falliva per questo motivo)

alter table team_members add column if not exists puo_scoutare boolean not null default false;
update team_members set puo_scoutare = true, ruolo = 'vice_allenatore' where ruolo = 'scout';

alter table team_members drop constraint if exists team_members_ruolo_check;
alter table team_members add constraint team_members_ruolo_check
  check (ruolo in ('allenatore','vice_allenatore','presidente','atleta'));

create or replace function is_team_scout(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
      and (ruolo in ('allenatore','vice_allenatore') or puo_scoutare = true)
  );
$$;

create or replace function imposta_permesso_scout(p_team_id uuid, p_user_id uuid, p_abilitato boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;
  update team_members set puo_scoutare = p_abilitato where team_id = p_team_id and user_id = p_user_id;
end;
$$;

drop function if exists elenca_membri_team(uuid);
create function elenca_membri_team(p_team_id uuid)
returns table(user_id uuid, email text, ruolo text, atleta_id uuid, atleta_nome text, puo_scoutare boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;

  return query
    select tm.user_id, u.email::text, tm.ruolo, tm.atleta_id,
           case when a.id is not null then a.nome || ' ' || a.cognome else null end,
           tm.puo_scoutare
    from team_members tm
    join auth.users u on u.id = tm.user_id
    left join athletes a on a.id = tm.atleta_id
    where tm.team_id = p_team_id
    order by tm.ruolo, u.email;
end;
$$;

alter table team_invites drop constraint if exists team_invites_ruolo_check;
update team_invites set ruolo = 'vice_allenatore' where ruolo = 'scout';
alter table team_invites add constraint team_invites_ruolo_check
  check (ruolo in ('allenatore','vice_allenatore','presidente','atleta'));

drop policy if exists "match_events_select_live" on match_events;
create policy "match_events_select_live" on match_events for select using (
  is_team_member((select team_id from matches where id = match_id))
  and (select stato from matches where id = match_id) = 'in_corso'
);

drop policy if exists "match_sets_select_live" on match_sets;
create policy "match_sets_select_live" on match_sets for select using (
  is_team_member((select team_id from matches where id = match_id))
);

revoke all on function imposta_permesso_scout(uuid, uuid, boolean) from public, anon;
grant execute on function imposta_permesso_scout(uuid, uuid, boolean) to authenticated, service_role;
