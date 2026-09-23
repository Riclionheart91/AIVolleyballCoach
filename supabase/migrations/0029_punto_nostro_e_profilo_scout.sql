-- 0029 — Punto senza attribuzione + profilo "scout"
--
-- Nota sul vocabolario: gli eventi partita usano "Servizio" mentre le
-- valutazioni usano "Battuta" (verrà unificato nella 0032). Il
-- vincolo accetta entrambi qui per non invalidare lo storico già
-- registrato al momento in cui questa migrazione fu scritta.

alter table match_events drop constraint if exists match_events_skill_check;
alter table match_events add constraint match_events_skill_check
  check (skill in ('Servizio','Battuta','Ricezione','Attacco','Muro','Difesa','Punto_avversario','Punto_nostro'));

alter table team_members drop constraint if exists team_members_ruolo_check;
alter table team_members add constraint team_members_ruolo_check
  check (ruolo in ('allenatore','vice_allenatore','presidente','atleta','scout'));

alter table team_invites drop constraint if exists team_invites_ruolo_check;
alter table team_invites add constraint team_invites_ruolo_check
  check (ruolo in ('allenatore','vice_allenatore','presidente','atleta','scout'));

create or replace function is_team_scout(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
      and ruolo in ('allenatore','vice_allenatore','scout')
  );
$$;

create or replace function registra_evento(p_match_id uuid, p_set_id uuid, p_skill text, p_esito text, p_athlete_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_stato_match text;
  v_evento_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select team_id, stato into v_team_id, v_stato_match from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;
  if v_stato_match = 'conclusa' then raise exception 'Partita già conclusa'; end if;
  if v_stato_match <> 'in_corso' then raise exception 'La partita non è ancora iniziata'; end if;

  if not exists (select 1 from match_sets where id = p_set_id and match_id = p_match_id for update) then
    raise exception 'Il set indicato non appartiene a questa partita';
  end if;
  if not exists (select 1 from match_set_lineups where set_id = p_set_id) then
    raise exception 'Formazione non impostata per questo set';
  end if;
  if p_athlete_id is not null and not exists (select 1 from athletes where id = p_athlete_id and team_id = v_team_id) then
    raise exception 'L''atleta indicata non appartiene a questa squadra';
  end if;

  insert into match_events (match_id, set_id, skill, esito, athlete_id, creato_da)
  values (p_match_id, p_set_id, p_skill, p_esito, p_athlete_id, auth.uid())
  returning id into v_evento_id;

  return v_evento_id;
end;
$$;

create or replace function cambia_giocatore(p_set_id uuid, p_atleta_uscente uuid, p_atleta_entrante uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_posizione integer;
begin
  select m.id, m.team_id into v_match_id, v_team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;

  select posizione into v_posizione from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_uscente and in_campo = true;
  if v_posizione is null then raise exception 'La giocatrice uscente non risulta in campo'; end if;
  if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = p_atleta_entrante) then
    raise exception 'La giocatrice entrante non è tra le convocate';
  end if;
  if exists (select 1 from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante and in_campo = true) then
    raise exception 'La giocatrice entrante è già in campo';
  end if;
  if exists (select 1 from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante and in_campo = false) then
    raise exception 'Questa giocatrice è già uscita in questo set e non può rientrare';
  end if;

  update match_set_lineups set in_campo = false, posizione = null where set_id = p_set_id and athlete_id = p_atleta_uscente;
  insert into match_set_lineups (set_id, athlete_id, in_campo, posizione)
  values (p_set_id, p_atleta_entrante, true, v_posizione)
  on conflict (set_id, athlete_id) do update set in_campo = true, posizione = v_posizione;
end;
$$;

create or replace function annulla_ultimo_evento(p_match_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_evento_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;

  select id into v_evento_id from match_events where match_id = p_match_id order by creato_il desc, id desc limit 1;
  if v_evento_id is not null then delete from match_events where id = v_evento_id; end if;
end;
$$;

drop policy if exists "match_events_select_scout" on match_events;
create policy "match_events_select_scout" on match_events for select
  using (is_team_scout((select team_id from matches where id = match_id)));

drop policy if exists "match_set_lineups_select_scout" on match_set_lineups;
create policy "match_set_lineups_select_scout" on match_set_lineups for select
  using (is_team_scout((select m.team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = set_id)));

drop policy if exists "match_convocati_select_scout" on match_convocati;
create policy "match_convocati_select_scout" on match_convocati for select
  using (is_team_scout((select team_id from matches where id = match_id)));

revoke all on function is_team_scout(uuid) from public, anon;
grant execute on function is_team_scout(uuid) to authenticated, service_role;
