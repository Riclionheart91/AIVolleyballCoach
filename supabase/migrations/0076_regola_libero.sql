-- Regola del Libero per partita: si sceglie una volta (a inizio partita) quale
-- Libero usare e su quali due centrali entra. Cosi' non si deve ripetere la
-- scelta ogni volta che il Libero esce. Se un centrale viene sostituito,
-- chi entra eredita l'associazione col Libero.
-- La tabella non ha policy di lettura/scrittura diretta: si usa solo tramite
-- le funzioni qui sotto (staff che scouta oppure scout ospite della partita).

create table if not exists match_libero_regola (
  match_id uuid primary key references matches(id) on delete cascade,
  libero_id uuid references athletes(id) on delete set null,
  titolare_1 uuid references athletes(id) on delete set null,
  titolare_2 uuid references athletes(id) on delete set null,
  aggiornato_il timestamptz not null default now()
);

alter table match_libero_regola enable row level security;
revoke all on match_libero_regola from anon, authenticated;

create or replace function leggi_regola_libero(p_match_id uuid)
returns table(libero_id uuid, titolare_1 uuid, titolare_2 uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_scout(v_team_id) or is_scout_ospite(p_match_id)) then raise exception 'Permesso negato'; end if;
  return query select r.libero_id, r.titolare_1, r.titolare_2 from match_libero_regola r where r.match_id = p_match_id;
end;
$$;

create or replace function imposta_regola_libero(p_match_id uuid, p_libero_id uuid, p_titolare_1 uuid, p_titolare_2 uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_scout(v_team_id) or is_scout_ospite(p_match_id)) then raise exception 'Permesso negato'; end if;

  if p_libero_id is not null and not exists (
    select 1 from match_convocati where match_id = p_match_id and athlete_id = p_libero_id and is_libero = true
  ) then raise exception 'Questa persona non è indicata come Libero nella distinta'; end if;

  if p_titolare_1 is not null and p_titolare_1 = p_titolare_2 then raise exception 'I due centrali devono essere diversi'; end if;
  if p_titolare_1 is not null and not exists (
    select 1 from match_convocati where match_id = p_match_id and athlete_id = p_titolare_1 and coalesce(is_libero, false) = false
  ) then raise exception 'Il primo centrale non è tra i convocati'; end if;
  if p_titolare_2 is not null and not exists (
    select 1 from match_convocati where match_id = p_match_id and athlete_id = p_titolare_2 and coalesce(is_libero, false) = false
  ) then raise exception 'Il secondo centrale non è tra i convocati'; end if;

  insert into match_libero_regola (match_id, libero_id, titolare_1, titolare_2, aggiornato_il)
  values (p_match_id, p_libero_id, p_titolare_1, p_titolare_2, now())
  on conflict (match_id) do update
    set libero_id = excluded.libero_id, titolare_1 = excluded.titolare_1, titolare_2 = excluded.titolare_2, aggiornato_il = now();
end;
$$;

revoke execute on function leggi_regola_libero(uuid) from public, anon;
revoke execute on function imposta_regola_libero(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function leggi_regola_libero(uuid) to authenticated;
grant execute on function imposta_regola_libero(uuid, uuid, uuid, uuid) to authenticated;

-- Sostituzione di un centrale: chi entra prende il suo posto nella regola del Libero.
create or replace function cambia_giocatore(p_set_id uuid, p_atleta_uscente uuid, p_atleta_entrante uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_posizione integer;
begin
  select m.id, m.team_id into v_match_id, v_team_id
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not (is_team_scout(v_team_id) or is_scout_ospite_set(p_set_id)) then raise exception 'Permesso negato'; end if;

  select posizione into v_posizione from match_set_lineups
  where set_id = p_set_id and athlete_id = p_atleta_uscente and in_campo = true;
  if v_posizione is null then raise exception 'Chi deve uscire non risulta in campo in questo set'; end if;

  if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = p_atleta_entrante) then
    raise exception 'Chi deve entrare non è tra i convocati di questa partita';
  end if;
  if exists (select 1 from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante and in_campo = true) then
    raise exception 'Chi deve entrare è già in campo';
  end if;
  if exists (select 1 from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante and in_campo = false) then
    raise exception 'Chi deve entrare è già uscito in questo set e non può rientrare';
  end if;

  update match_set_lineups set in_campo = false, posizione = null
  where set_id = p_set_id and athlete_id = p_atleta_uscente;

  insert into match_set_lineups (set_id, athlete_id, in_campo, posizione)
  values (p_set_id, p_atleta_entrante, true, v_posizione)
  on conflict (set_id, athlete_id) do update set in_campo = true, posizione = v_posizione;

  -- Se usciva un centrale associato al Libero, l'associazione passa a chi entra.
  update match_libero_regola
  set titolare_1 = case when titolare_1 = p_atleta_uscente then p_atleta_entrante else titolare_1 end,
      titolare_2 = case when titolare_2 = p_atleta_uscente then p_atleta_entrante else titolare_2 end,
      aggiornato_il = now()
  where match_id = v_match_id and p_atleta_uscente in (titolare_1, titolare_2);
end;
$function$;
