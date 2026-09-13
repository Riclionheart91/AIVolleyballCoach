-- ============================================================
-- 0016 — Conversione manuale allenamento ↔ partita
--
-- La classificazione automatica degli eventi importati da SportEasy si
-- basa sul titolo ("Peach Gate - Allenamento" vs "Peach Gate -
-- Avversario"): è una regola pratica, non può essere infallibile. Con
-- queste funzioni l'allenatore corregge a mano i casi sbagliati senza
-- dover ricreare l'evento da zero.
--
-- L'identificativo SportEasy (sporteasy_uid) viene SPOSTATO sul nuovo
-- record: così una risincronizzazione successiva riconosce l'evento
-- come già importato e non lo ricrea nella categoria sbagliata,
-- vanificando la correzione.
-- ============================================================

create or replace function converti_allenamento_in_partita(p_training_id uuid, p_avversario text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_titolo text;
  v_data timestamptz;
  v_uid text;
  v_match_id uuid;
  v_campionato_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select team_id, titolo, data, sporteasy_uid into v_team_id, v_titolo, v_data, v_uid
  from trainings where id = p_training_id;
  if v_team_id is null then raise exception 'Allenamento non trovato'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  -- Se ci sono già presenze/RPE registrati, convertire cancellerebbe
  -- quei dati (eliminati a cascata insieme all'allenamento): meglio
  -- fermarsi e dirlo, invece di far sparire lavoro già fatto.
  if exists (select 1 from attendance where training_id = p_training_id)
     or exists (select 1 from rpe where training_id = p_training_id) then
    raise exception 'Questo allenamento ha già presenze o RPE registrati: non può essere convertito in partita senza perderli';
  end if;

  select trova_campionato_per_data(v_team_id, v_data::date) into v_campionato_id;

  insert into matches (team_id, avversario, data, luogo, stato, sporteasy_uid, campionato_id, tipo_gara)
  values (
    v_team_id,
    coalesce(nullif(trim(p_avversario), ''), v_titolo, 'Avversario'),
    v_data, 'casa', 'programmata', v_uid, v_campionato_id,
    case when v_campionato_id is not null then 'campionato' else 'amichevole' end
  )
  returning id into v_match_id;

  delete from training_exercises where training_id = p_training_id;
  delete from trainings where id = p_training_id;

  return v_match_id;
end;
$$;

create or replace function converti_partita_in_allenamento(p_match_id uuid, p_titolo text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_avversario text;
  v_data timestamptz;
  v_uid text;
  v_training_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select team_id, avversario, data, sporteasy_uid into v_team_id, v_avversario, v_data, v_uid
  from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  -- Stessa cautela: una partita con eventi di scouting registrati
  -- contiene dati di gioco che andrebbero persi.
  if exists (select 1 from match_events where match_id = p_match_id) then
    raise exception 'Questa partita ha già eventi di scouting registrati: non può essere convertita in allenamento senza perderli';
  end if;

  insert into trainings (team_id, titolo, data, note, sporteasy_uid)
  values (v_team_id, coalesce(nullif(trim(p_titolo), ''), v_avversario, 'Allenamento'), v_data, '', v_uid)
  returning id into v_training_id;

  delete from match_convocati where match_id = p_match_id;
  delete from match_sets where match_id = p_match_id;
  delete from matches where id = p_match_id;

  return v_training_id;
end;
$$;

revoke execute on function converti_allenamento_in_partita(uuid, text) from anon;
revoke execute on function converti_partita_in_allenamento(uuid, text) from anon;
grant execute on function converti_allenamento_in_partita(uuid, text) to authenticated;
grant execute on function converti_partita_in_allenamento(uuid, text) to authenticated;
