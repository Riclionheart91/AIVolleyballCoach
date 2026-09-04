-- ============================================================
-- 0007 — Hardening di sicurezza
--
-- Risponde a un audit di sicurezza sullo schema. Copre: search_path
-- mancante su varie funzioni SECURITY DEFINER, creazione di team
-- "orfani" (senza allenatore) ancora possibile via insert diretto,
-- consistenza cross-team non garantita solo da RLS, race condition in
-- registra_evento, quota AI non verificata per team, privilegi
-- EXECUTE non espliciti.
-- ============================================================

-- 1. search_path mancante su funzioni già corrette altrove -----------------
-- ALTER FUNCTION invece di riscriverle: nessun cambio di comportamento,
-- solo l'attributo di sicurezza mancante.
alter function crea_team_e_diventa_allenatore(text) set search_path = public;
alter function aggiorna_mio_contatto(uuid, text, text, text) set search_path = public;
alter function andamento_squadra_valutazioni(uuid) set search_path = public;
alter function attiva_stagione(uuid) set search_path = public;
alter function concludi_stagione(uuid) set search_path = public;
alter function genera_baseline_stagione(uuid) set search_path = public;
alter function crea_match(uuid, text, timestamptz, text) set search_path = public;
alter function nuovo_set(uuid) set search_path = public;
alter function annulla_ultimo_evento(uuid) set search_path = public;
alter function chiudi_match(uuid) set search_path = public;
alter function andamento_squadra_partite(uuid) set search_path = public;
alter function imposta_integrazione_sporteasy(uuid, text) set search_path = public;
alter function avvia_match(uuid) set search_path = public;
alter function decidi_proposta_valutazione(uuid, numeric, text) set search_path = public;
alter function rigetta_proposta_valutazione(uuid) set search_path = public;
-- registra_evento viene ridefinita per intero più sotto (nuovi controlli),
-- quindi il suo search_path si imposta lì direttamente, non qui.

-- 2. Blocca la creazione di team "orfani" -----------------------------------
-- Prima chiunque autenticato poteva fare un insert diretto su "teams"
-- senza passare da crea_team_e_diventa_allenatore(), creando una
-- squadra senza nessun allenatore collegato. La creazione ora passa
-- SOLO dalla RPC (che è SECURITY DEFINER e crea team+primo membro
-- nella stessa transazione).
drop policy if exists "teams_insert_any_auth" on teams;

create or replace function crea_team_e_diventa_allenatore(p_nome text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_nome_pulito text;
begin
  if auth.uid() is null then
    raise exception 'Utente non autenticato';
  end if;
  v_nome_pulito := trim(p_nome);
  if v_nome_pulito = '' or v_nome_pulito is null then
    raise exception 'Il nome della squadra non può essere vuoto';
  end if;

  insert into teams (nome, creato_da) values (v_nome_pulito, auth.uid()) returning id into v_team_id;
  insert into team_members (team_id, user_id, ruolo) values (v_team_id, auth.uid(), 'allenatore');
  return v_team_id;
end;
$$;

-- 3. registra_evento rafforzata ---------------------------------------------
-- Prima verificava solo "la partita esiste" + "sei coach del team". Non
-- verificava che il set appartenesse davvero a quella partita (si
-- poteva registrare un evento passando il set_id di UN'ALTRA partita),
-- né che l'atleta indicata appartenesse allo stesso team, né che la
-- partita non fosse già conclusa. Aggiunto anche un lock esplicito sul
-- set per serializzare inserimenti concorrenti sullo stesso set (due
-- tap quasi simultanei non devono poter corrompere il punteggio).
create or replace function registra_evento(p_match_id uuid, p_set_id uuid, p_skill text, p_esito text, p_athlete_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_stato_match text;
  v_evento_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Utente non autenticato';
  end if;

  select team_id, stato into v_team_id, v_stato_match from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;
  if v_stato_match = 'conclusa' then raise exception 'Partita già conclusa, non è più possibile registrare eventi'; end if;

  -- FOR UPDATE: blocca la riga del set per la durata della transazione,
  -- così due registrazioni quasi simultanee sullo stesso set si
  -- accodano invece di poter leggere lo stesso punteggio "vecchio" ed
  -- eseguire entrambe un incremento basato su un valore ormai superato.
  if not exists (select 1 from match_sets where id = p_set_id and match_id = p_match_id for update) then
    raise exception 'Il set indicato non appartiene a questa partita';
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

-- 4. Consistenza cross-team ---------------------------------------------
-- La RLS controlla CHI può vedere/scrivere una riga, ma non impedisce
-- da sola che una riga colleghi entità di team diversi (es. un'atleta
-- del team A assegnata per errore a un allenamento del team B). Un
-- trigger di validazione lo garantisce indipendentemente dalla RLS.

create or replace function verifica_stesso_team_training_athlete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_training uuid;
  v_team_athlete uuid;
begin
  select team_id into v_team_training from trainings where id = NEW.training_id;
  select team_id into v_team_athlete from athletes where id = NEW.athlete_id;
  if v_team_training is distinct from v_team_athlete then
    raise exception 'L''atleta non appartiene alla stessa squadra dell''allenamento';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_attendance on attendance;
create trigger trg_verifica_team_attendance before insert or update on attendance
  for each row execute function verifica_stesso_team_training_athlete();

drop trigger if exists trg_verifica_team_rpe on rpe;
create trigger trg_verifica_team_rpe before insert or update on rpe
  for each row execute function verifica_stesso_team_training_athlete();

create or replace function verifica_stesso_team_match_athlete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_match uuid;
  v_team_athlete uuid;
begin
  if NEW.athlete_id is null then return NEW; end if;
  select team_id into v_team_match from matches where id = NEW.match_id;
  select team_id into v_team_athlete from athletes where id = NEW.athlete_id;
  if v_team_match is distinct from v_team_athlete then
    raise exception 'L''atleta non appartiene alla squadra di questa partita';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_match_events on match_events;
create trigger trg_verifica_team_match_events before insert or update on match_events
  for each row execute function verifica_stesso_team_match_athlete();

create or replace function verifica_set_appartiene_a_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_del_set uuid;
begin
  select match_id into v_match_del_set from match_sets where id = NEW.set_id;
  if v_match_del_set is distinct from NEW.match_id then
    raise exception 'Il set indicato appartiene a un''altra partita';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_set_match on match_events;
create trigger trg_verifica_set_match before insert or update on match_events
  for each row execute function verifica_set_appartiene_a_match();

create or replace function verifica_stesso_team_evaluation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_athlete uuid;
begin
  select team_id into v_team_athlete from athletes where id = NEW.athlete_id;
  if v_team_athlete is distinct from NEW.team_id then
    raise exception 'L''atleta non appartiene alla squadra indicata nella valutazione';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_evaluations on evaluations;
create trigger trg_verifica_team_evaluations before insert or update on evaluations
  for each row execute function verifica_stesso_team_evaluation();

create or replace function verifica_stesso_team_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_season uuid;
  v_team_athlete uuid;
begin
  select team_id into v_team_season from seasons where id = NEW.season_id;
  select team_id into v_team_athlete from athletes where id = NEW.athlete_id;
  if v_team_season is distinct from v_team_athlete then
    raise exception 'L''atleta non appartiene alla squadra di questa stagione';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_baseline on season_baselines;
create trigger trg_verifica_team_baseline before insert or update on season_baselines
  for each row execute function verifica_stesso_team_baseline();

create or replace function verifica_stesso_team_training_exercise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_training uuid;
  v_team_exercise uuid;
begin
  select team_id into v_team_training from trainings where id = NEW.training_id;
  select team_id into v_team_exercise from exercises where id = NEW.exercise_id;
  if v_team_training is distinct from v_team_exercise then
    raise exception 'L''esercizio non appartiene alla stessa squadra dell''allenamento';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_training_exercises on training_exercises;
create trigger trg_verifica_team_training_exercises before insert or update on training_exercises
  for each row execute function verifica_stesso_team_training_exercise();

-- team_invites.atleta_id vs team dell'invito: già verificato dentro
-- invita_membro() (raise exception se la scheda non è dello stesso
-- team), non serve un trigger duplicato — l'unico punto di scrittura
-- passa da lì.

-- team_members.atleta_id vs athletes.team_id: già verificato dentro
-- invita_membro()/accetta_inviti_pendenti() allo stesso modo; aggiunto
-- comunque un trigger come rete di sicurezza in caso di scritture
-- future che non passino da quelle RPC.
create or replace function verifica_stesso_team_member_atleta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_atleta uuid;
begin
  if NEW.atleta_id is null then return NEW; end if;
  select team_id into v_team_atleta from athletes where id = NEW.atleta_id;
  if v_team_atleta is distinct from NEW.team_id then
    raise exception 'La scheda atleta collegata non appartiene a questa squadra';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_member_atleta on team_members;
create trigger trg_verifica_team_member_atleta before insert or update on team_members
  for each row execute function verifica_stesso_team_member_atleta();

-- 5. Quota AI verificata per team -------------------------------------------
-- Prima chiunque autenticato poteva interrogare la quota residua di
-- QUALUNQUE team passando un team_id a piacere: la funzione calcolava
-- comunque il valore corretto, ma un utente estraneo poteva comunque
-- "sbirciare" quante chiamate AI ha fatto un team a cui non appartiene.
create or replace function ai_chiamate_residue_oggi(p_team_id uuid)
returns integer
language sql stable
security definer
set search_path = public
as $$
  select case when is_team_member(p_team_id) then
    greatest(0, 20 - (select count(*)::integer from ai_call_log where team_id = p_team_id and creato_il >= date_trunc('day', now())))
  else 0 end;
$$;

-- 6. Privilegi EXECUTE espliciti ---------------------------------------------
-- Le funzioni helper (is_team_member e affini) servono SOLO dentro le
-- policy RLS e devono restare eseguibili da "authenticated" (altrimenti
-- le policy stesse smetterebbero di funzionare), ma non hanno motivo di
-- essere chiamabili da "anon". Le RPC applicative sono già protette dai
-- controlli interni (is_team_coach, auth.uid() is null, ecc.): qui
-- rendiamo esplicito anche a livello di privilegi che "anon" non deve
-- poterle nemmeno invocare.
revoke execute on function is_team_member(uuid) from anon;
revoke execute on function is_team_coach(uuid) from anon;
revoke execute on function is_team_presidente(uuid) from anon;
revoke execute on function is_team_staff_visione_piena(uuid) from anon;
revoke execute on function mio_atleta_id(uuid) from anon;
revoke execute on function is_superuser() from anon;
revoke execute on function sono_superuser() from anon;

revoke execute on function crea_team_e_diventa_allenatore(text) from anon;
revoke execute on function invita_membro(uuid, text, text, uuid) from anon;
revoke execute on function accetta_inviti_pendenti() from anon;
revoke execute on function aggiorna_mio_contatto(uuid, text, text, text) from anon;
revoke execute on function decidi_proposta_valutazione(uuid, numeric, text) from anon;
revoke execute on function rigetta_proposta_valutazione(uuid) from anon;
revoke execute on function genera_baseline_stagione(uuid) from anon;
revoke execute on function attiva_stagione(uuid) from anon;
revoke execute on function concludi_stagione(uuid) from anon;
revoke execute on function crea_match(uuid, text, timestamptz, text) from anon;
revoke execute on function nuovo_set(uuid) from anon;
revoke execute on function registra_evento(uuid, uuid, text, text, uuid) from anon;
revoke execute on function annulla_ultimo_evento(uuid) from anon;
revoke execute on function chiudi_match(uuid) from anon;
revoke execute on function avvia_match(uuid) from anon;
revoke execute on function imposta_integrazione_sporteasy(uuid, text) from anon;
revoke execute on function andamento_squadra_valutazioni(uuid) from anon;
revoke execute on function andamento_squadra_partite(uuid) from anon;
revoke execute on function ai_chiamate_residue_oggi(uuid) from anon;

-- Concessione esplicita ad "authenticated": Postgres di default concede
-- EXECUTE a PUBLIC su ogni nuova funzione, quindi tecnicamente
-- funzionerebbe comunque — ma essere espliciti qui significa che se in
-- futuro qualcuno cambia i privilegi di default del database,
-- l'applicazione non smette di funzionare in silenzio.
grant execute on function is_team_member(uuid) to authenticated;
grant execute on function is_team_coach(uuid) to authenticated;
grant execute on function is_team_presidente(uuid) to authenticated;
grant execute on function is_team_staff_visione_piena(uuid) to authenticated;
grant execute on function mio_atleta_id(uuid) to authenticated;
grant execute on function is_superuser() to authenticated;
grant execute on function sono_superuser() to authenticated;
grant execute on function crea_team_e_diventa_allenatore(text) to authenticated;
grant execute on function invita_membro(uuid, text, text, uuid) to authenticated;
grant execute on function accetta_inviti_pendenti() to authenticated;
grant execute on function aggiorna_mio_contatto(uuid, text, text, text) to authenticated;
grant execute on function decidi_proposta_valutazione(uuid, numeric, text) to authenticated;
grant execute on function rigetta_proposta_valutazione(uuid) to authenticated;
grant execute on function genera_baseline_stagione(uuid) to authenticated;
grant execute on function attiva_stagione(uuid) to authenticated;
grant execute on function concludi_stagione(uuid) to authenticated;
grant execute on function crea_match(uuid, text, timestamptz, text) to authenticated;
grant execute on function nuovo_set(uuid) to authenticated;
grant execute on function registra_evento(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function annulla_ultimo_evento(uuid) to authenticated;
grant execute on function chiudi_match(uuid) to authenticated;
grant execute on function avvia_match(uuid) to authenticated;
grant execute on function imposta_integrazione_sporteasy(uuid, text) to authenticated;
grant execute on function andamento_squadra_valutazioni(uuid) to authenticated;
grant execute on function andamento_squadra_partite(uuid) to authenticated;
grant execute on function ai_chiamate_residue_oggi(uuid) to authenticated;

-- 7. Indici mancanti dall'audit ----------------------------------------------
create index if not exists idx_team_members_team_user on team_members (team_id, user_id);
create index if not exists idx_team_members_user_team on team_members (user_id, team_id);
create index if not exists idx_evaluations_team_athlete on evaluations (team_id, athlete_id);
-- idx_seasons_team_lookup e idx_matches_team_lookup NON aggiunti: sarebbero
-- ridondanti rispetto agli indici compositi già esistenti
-- idx_seasons_team (team_id, data_apertura) e idx_matches_team (team_id,
-- data) — un indice composito copre già le ricerche sul solo team_id.
create index if not exists idx_match_events_match_set_creato on match_events (match_id, set_id, creato_il desc);
create index if not exists idx_team_invites_email_lower on team_invites (lower(email));
-- idx_ai_call_log_team_creato NON aggiunto: ridondante rispetto a
-- idx_ai_call_log_team_giorno (team_id, creato_il desc) già esistente —
-- un B-tree si legge in entrambe le direzioni, non serve la versione
-- ascendente oltre a quella discendente sulle stesse colonne.

