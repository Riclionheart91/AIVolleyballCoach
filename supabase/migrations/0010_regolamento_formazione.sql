-- ============================================================
-- 0010 — Regolamento configurabile, convocati, formazione a posizioni,
-- rotazione automatica, avvio esplicito della partita
--
-- Sostituisce il meccanismo di formazione di 0009 (solo "chi è in
-- campo", nessuna posizione/rotazione) con uno aderente alle regole
-- vere del gioco (vedi REGOLE_PALLAVOLO.md): 6 posizioni numerate,
-- rotazione oraria automatica ad ogni cambio palla, gestita dal
-- database via trigger — mai calcolata a mano lato client.
--
-- "campionati" rende configurabili (non hardcoded) i parametri che
-- cambiano da federazione a federazione (FIPAV/PGS/CSI) e anche da
-- torneo a torneo nella stessa federazione: punti per set, numero
-- massimo Libero, sostituzioni, numerazione maglia, dimensione
-- distinta gara. Una squadra può avere più campionati contemporaneamente
-- (gioca sia FIPAV sia CSI): ogni PARTITA sceglie il proprio, non è
-- un'impostazione fissa della squadra.
-- ============================================================

create table if not exists campionati (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  nome text not null,
  federazione text not null default 'FIPAV' check (federazione in ('FIPAV', 'PGS', 'CSI', 'ALTRO')),
  punti_per_set integer not null default 25,
  punti_set_decisivo integer not null default 15,
  numero_liberi_max integer not null default 2,
  numero_sostituzioni_max_per_set integer not null default 6,
  numero_maglia_max integer not null default 99,
  distinta_min_giocatrici integer not null default 6,
  distinta_max_giocatrici integer not null default 14,
  attivo boolean not null default true,
  creato_il timestamptz not null default now()
);

alter table campionati enable row level security;
drop policy if exists "campionati_select_member" on campionati;
create policy "campionati_select_member" on campionati for select using (is_team_member(team_id) or is_superuser());
drop policy if exists "campionati_write_coach" on campionati;
create policy "campionati_write_coach" on campionati for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

-- 1. Partite: campionato di riferimento + tipo gara ------------------------
alter table matches add column if not exists campionato_id uuid references campionati on delete set null;
alter table matches add column if not exists tipo_gara text not null default 'amichevole' check (tipo_gara in ('campionato', 'amichevole'));

-- 2. Convocati (distinta gara) — possono essere meno dell'intera rosa ------
create table if not exists match_convocati (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches on delete cascade,
  athlete_id uuid not null references athletes on delete cascade,
  is_libero boolean not null default false,
  unique (match_id, athlete_id)
);

alter table match_convocati enable row level security;
drop policy if exists "match_convocati_select_ristretta" on match_convocati;
create policy "match_convocati_select_ristretta" on match_convocati for select using (
  is_team_staff_visione_piena((select team_id from matches where id = match_id))
  or athlete_id = mio_atleta_id((select team_id from matches where id = match_id))
  or is_superuser()
);

-- 3. Formazione: posizione reale (1-6) invece di solo presenza -------------
alter table match_set_lineups add column if not exists posizione integer check (posizione between 1 and 6);
create unique index if not exists idx_match_set_lineups_posizione
  on match_set_lineups (set_id, posizione) where in_campo = true and posizione is not null;

-- 4. Stato del servizio, per sapere quando ruotare -------------------------
alter table match_sets add column if not exists squadra_al_servizio text check (squadra_al_servizio in ('noi', 'avversario'));

-- 5. match_events: istantanea per poter annullare la rotazione ------------
-- "Annulla ultima azione" deve poter riportare indietro ANCHE la
-- rotazione/il turno di servizio se l'evento cancellato li aveva
-- causati — altrimenti annullare un punto lascerebbe la formazione
-- ruotata per errore.
alter table match_events add column if not exists rotazione_applicata boolean not null default false;
alter table match_events add column if not exists servizio_precedente text;

-- 6. Rotazione oraria (Art. 7.6 del regolamento) ---------------------------
create or replace function ruota_formazione(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos record;
  v_mappa jsonb := '{}'::jsonb;
begin
  for v_pos in select athlete_id, posizione from match_set_lineups where set_id = p_set_id and in_campo = true and posizione is not null
  loop
    v_mappa := v_mappa || jsonb_build_object(v_pos.posizione::text, v_pos.athlete_id::text);
  end loop;

  if v_mappa = '{}'::jsonb then return; end if;

  update match_set_lineups set posizione = 1 where set_id = p_set_id and athlete_id = (v_mappa->>'2')::uuid;
  update match_set_lineups set posizione = 6 where set_id = p_set_id and athlete_id = (v_mappa->>'1')::uuid;
  update match_set_lineups set posizione = 5 where set_id = p_set_id and athlete_id = (v_mappa->>'6')::uuid;
  update match_set_lineups set posizione = 4 where set_id = p_set_id and athlete_id = (v_mappa->>'5')::uuid;
  update match_set_lineups set posizione = 3 where set_id = p_set_id and athlete_id = (v_mappa->>'4')::uuid;
  update match_set_lineups set posizione = 2 where set_id = p_set_id and athlete_id = (v_mappa->>'3')::uuid;
end;
$$;

-- Rotazione inversa, usata solo da "annulla ultima azione" per
-- riportare la formazione com'era prima dell'evento cancellato.
create or replace function ruota_formazione_indietro(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos record;
  v_mappa jsonb := '{}'::jsonb;
begin
  for v_pos in select athlete_id, posizione from match_set_lineups where set_id = p_set_id and in_campo = true and posizione is not null
  loop
    v_mappa := v_mappa || jsonb_build_object(v_pos.posizione::text, v_pos.athlete_id::text);
  end loop;

  if v_mappa = '{}'::jsonb then return; end if;

  update match_set_lineups set posizione = 2 where set_id = p_set_id and athlete_id = (v_mappa->>'1')::uuid;
  update match_set_lineups set posizione = 1 where set_id = p_set_id and athlete_id = (v_mappa->>'6')::uuid;
  update match_set_lineups set posizione = 6 where set_id = p_set_id and athlete_id = (v_mappa->>'5')::uuid;
  update match_set_lineups set posizione = 5 where set_id = p_set_id and athlete_id = (v_mappa->>'4')::uuid;
  update match_set_lineups set posizione = 4 where set_id = p_set_id and athlete_id = (v_mappa->>'3')::uuid;
  update match_set_lineups set posizione = 3 where set_id = p_set_id and athlete_id = (v_mappa->>'2')::uuid;
end;
$$;

-- 7. Trigger: cattura lo stato PRIMA dell'evento (per poter annullare) -----
create or replace function cattura_stato_servizio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_servizio_attuale text;
  v_punto_nostro boolean;
  v_punto_avversario boolean;
begin
  select squadra_al_servizio into v_servizio_attuale from match_sets where id = NEW.set_id;
  NEW.servizio_precedente := v_servizio_attuale;

  v_punto_avversario := (NEW.skill = 'Punto_avversario' or NEW.esito = 'errore');
  v_punto_nostro := (NEW.esito = 'punto');

  -- "Rotazione applicata" = eravamo in ricezione e abbiamo vinto lo
  -- scambio (side-out a nostro favore): è l'unico caso in cui si ruota.
  NEW.rotazione_applicata := v_punto_nostro and v_servizio_attuale is distinct from 'noi';

  return NEW;
end;
$$;

drop trigger if exists trg_cattura_stato_servizio on match_events;
create trigger trg_cattura_stato_servizio before insert on match_events
  for each row execute function cattura_stato_servizio();

-- 8. Trigger: applica la rotazione/il cambio servizio DOPO l'inserimento ---
create or replace function applica_rotazione_dopo_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_punto_nostro boolean;
  v_punto_avversario boolean;
begin
  v_punto_avversario := (NEW.skill = 'Punto_avversario' or NEW.esito = 'errore');
  v_punto_nostro := (NEW.esito = 'punto');

  if NEW.rotazione_applicata then
    perform ruota_formazione(NEW.set_id);
    update match_sets set squadra_al_servizio = 'noi' where id = NEW.set_id;
  elsif v_punto_avversario and NEW.servizio_precedente is distinct from 'avversario' then
    update match_sets set squadra_al_servizio = 'avversario' where id = NEW.set_id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_applica_rotazione on match_events;
create trigger trg_applica_rotazione after insert on match_events
  for each row execute function applica_rotazione_dopo_evento();

-- 9. Trigger: annulla la rotazione/il servizio quando si cancella l'evento -
create or replace function annulla_rotazione_dopo_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.rotazione_applicata then
    perform ruota_formazione_indietro(OLD.set_id);
  end if;
  update match_sets set squadra_al_servizio = OLD.servizio_precedente where id = OLD.set_id;
  return OLD;
end;
$$;

drop trigger if exists trg_annulla_rotazione on match_events;
create trigger trg_annulla_rotazione after delete on match_events
  for each row execute function annulla_rotazione_dopo_delete();

-- 10. RPC: crea_match NON avvia più subito la partita ----------------------
-- Prima creava anche il set 1 e segnava la partita "in_corso"
-- immediatamente. Ora si limita a creare la riga "programmata": la
-- partita entra davvero in gioco solo dopo convocati + formazione +
-- il pulsante esplicito di avvio (avvia_match_confermato).
--
-- IMPORTANTE: questa versione ha 6 parametri, la precedente (0003) ne
-- aveva 4. CREATE OR REPLACE con una firma diversa non sostituisce la
-- funzione, la SOVRACCARICA — il database si ritrovava con due
-- "crea_match" distinte, causa reale del pulsante che sembrava non
-- funzionare (stesso problema già visto con invita_membro). Il DROP
-- esplicito qui sotto rimuove la vecchia firma prima di ricreare quella
-- nuova.
drop function if exists crea_match(uuid, text, timestamptz, text);

create or replace function crea_match(p_team_id uuid, p_avversario text, p_data timestamptz, p_luogo text default 'casa', p_campionato_id uuid default null, p_tipo_gara text default 'amichevole')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;
  if p_tipo_gara not in ('campionato', 'amichevole') then raise exception 'Tipo gara non valido'; end if;
  if p_campionato_id is not null and not exists (select 1 from campionati where id = p_campionato_id and team_id = p_team_id) then
    raise exception 'Campionato non trovato per questa squadra';
  end if;

  insert into matches (team_id, avversario, data, luogo, stato, campionato_id, tipo_gara)
  values (p_team_id, p_avversario, p_data, p_luogo, 'programmata', p_campionato_id, p_tipo_gara)
  returning id into v_match_id;

  return v_match_id;
end;
$$;

-- Crea il set 1 se non esiste (serve come "ancora" per i convocati e la
-- formazione) SENZA avviare la partita — sostituisce la vecchia
-- avvia_match, che invece la avviava subito.
create or replace function avvia_preparazione_match(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_set_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  select id into v_set_id from match_sets where match_id = p_match_id and numero_set = 1;
  if v_set_id is null then
    insert into match_sets (match_id, numero_set) values (p_match_id, 1) returning id into v_set_id;
  end if;

  return v_set_id;
end;
$$;

create or replace function imposta_convocati(p_match_id uuid, p_athlete_ids uuid[], p_libero_ids uuid[] default array[]::uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_campionato record;
  v_athlete_id uuid;
begin
  select team_id, campionato_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  if array_length(p_athlete_ids, 1) is null or array_length(p_athlete_ids, 1) < 1 then
    raise exception 'Serve almeno una convocata';
  end if;

  -- Se la partita è legata a un campionato con regole di distinta
  -- configurate, verifica i limiti (min/max giocatrici, max Libero) —
  -- altrimenti (amichevole senza campionato) nessun vincolo numerico.
  select c.* into v_campionato from matches m join campionati c on c.id = m.campionato_id where m.id = p_match_id;
  if found then
    if array_length(p_athlete_ids, 1) < v_campionato.distinta_min_giocatrici or array_length(p_athlete_ids, 1) > v_campionato.distinta_max_giocatrici then
      raise exception 'La distinta deve avere tra % e % giocatrici per questo campionato (indicate: %)', v_campionato.distinta_min_giocatrici, v_campionato.distinta_max_giocatrici, array_length(p_athlete_ids, 1);
    end if;
    if array_length(p_libero_ids, 1) is not null and array_length(p_libero_ids, 1) > v_campionato.numero_liberi_max then
      raise exception 'Massimo % Libero per questo campionato', v_campionato.numero_liberi_max;
    end if;
  end if;

  foreach v_athlete_id in array p_athlete_ids
  loop
    if not exists (select 1 from athletes where id = v_athlete_id and team_id = v_team_id) then
      raise exception 'Una delle convocate non appartiene a questa squadra';
    end if;
  end loop;

  delete from match_convocati where match_id = p_match_id;
  foreach v_athlete_id in array p_athlete_ids
  loop
    insert into match_convocati (match_id, athlete_id, is_libero) values (p_match_id, v_athlete_id, v_athlete_id = any(p_libero_ids));
  end loop;
end;
$$;

-- Formazione iniziale: 6 posizioni + chi serve per prima in questo set.
-- p_posizioni = {"1": "uuid-atleta", "2": "uuid-atleta", ..., "6": "uuid-atleta"}
create or replace function imposta_formazione_iniziale(p_set_id uuid, p_posizioni jsonb, p_chi_serve text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_pos integer;
  v_athlete_id uuid;
begin
  select m.id, m.team_id into v_match_id, v_team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;
  if p_chi_serve not in ('noi', 'avversario') then raise exception 'Indica chi serve per prima (noi/avversario)'; end if;
  if p_posizioni is null or p_posizioni = '{}'::jsonb then raise exception 'Formazione vuota'; end if;

  for v_pos in 1..6
  loop
    if not (p_posizioni ? v_pos::text) then
      raise exception 'Manca la posizione % nella formazione', v_pos;
    end if;
    v_athlete_id := (p_posizioni->>v_pos::text)::uuid;
    if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = v_athlete_id) then
      raise exception 'Una delle giocatrici in formazione non è tra le convocate per questa partita';
    end if;
  end loop;

  delete from match_set_lineups where set_id = p_set_id;
  for v_pos in 1..6
  loop
    insert into match_set_lineups (set_id, athlete_id, in_campo, posizione)
    values (p_set_id, (p_posizioni->>v_pos::text)::uuid, true, v_pos);
  end loop;

  update match_sets set squadra_al_servizio = p_chi_serve where id = p_set_id;
end;
$$;

-- Il "pulsante grande": SOLO da qui la partita diventa davvero
-- operativa (registra_evento la richiede esplicitamente, vedi sotto).
create or replace function avvia_match_confermato(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_set_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  select id into v_set_id from match_sets where match_id = p_match_id and numero_set = 1;
  if v_set_id is null or not exists (select 1 from match_set_lineups where set_id = v_set_id) then
    raise exception 'Imposta prima convocati e formazione iniziale';
  end if;

  update matches set stato = 'in_corso' where id = p_match_id;
end;
$$;

-- registra_evento: ora richiede esplicitamente che la partita sia stata
-- avviata (non basta più "esiste"), e che questo set abbia una
-- formazione impostata.
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
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select team_id, stato into v_team_id, v_stato_match from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;
  if v_stato_match = 'conclusa' then raise exception 'Partita già conclusa, non è più possibile registrare eventi'; end if;
  if v_stato_match <> 'in_corso' then raise exception 'La partita non è ancora iniziata: imposta convocati e formazione, poi premi Inizia partita'; end if;

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

-- 11. Cambio giocatore (sostituzione) ---------------------------------------
-- Versione base: sposta la posizione dall'uscente all'entrante. Non
-- applica ancora tutti i vincoli di regolamento (una titolare può
-- rientrare una sola volta nella stessa posizione, una riserva può
-- essere sostituita solo dalla stessa titolare, ecc. — vedi
-- REGOLE_PALLAVOLO.md) — quelli restano da affinare in un secondo
-- momento se servono davvero durante l'uso reale.
create or replace function cambia_giocatore(p_set_id uuid, p_atleta_uscente uuid, p_atleta_entrante uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_posizione integer;
begin
  select m.id, m.team_id into v_match_id, v_team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  select posizione into v_posizione from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_uscente and in_campo = true;
  if v_posizione is null then raise exception 'La giocatrice uscente non risulta in campo in questo set'; end if;

  if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = p_atleta_entrante) then
    raise exception 'La giocatrice entrante non è tra le convocate per questa partita';
  end if;
  if exists (select 1 from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante and in_campo = true) then
    raise exception 'La giocatrice entrante è già in campo';
  end if;

  update match_set_lineups set in_campo = false, posizione = null where set_id = p_set_id and athlete_id = p_atleta_uscente;

  insert into match_set_lineups (set_id, athlete_id, in_campo, posizione)
  values (p_set_id, p_atleta_entrante, true, v_posizione)
  on conflict (set_id, athlete_id) do update set in_campo = true, posizione = v_posizione;
end;
$$;

revoke execute on function crea_match(uuid, text, timestamptz, text, uuid, text) from anon;
revoke execute on function avvia_preparazione_match(uuid) from anon;
revoke execute on function imposta_convocati(uuid, uuid[], uuid[]) from anon;
revoke execute on function imposta_formazione_iniziale(uuid, jsonb, text) from anon;
revoke execute on function avvia_match_confermato(uuid) from anon;
revoke execute on function cambia_giocatore(uuid, uuid, uuid) from anon;
grant execute on function crea_match(uuid, text, timestamptz, text, uuid, text) to authenticated;
grant execute on function avvia_preparazione_match(uuid) to authenticated;
grant execute on function imposta_convocati(uuid, uuid[], uuid[]) to authenticated;
grant execute on function imposta_formazione_iniziale(uuid, jsonb, text) to authenticated;
grant execute on function avvia_match_confermato(uuid) to authenticated;
grant execute on function cambia_giocatore(uuid, uuid, uuid) to authenticated;

-- 12. Compatibilità con la vecchia avvia_match(uuid) -----------------------
-- Prima creava il set 1 E segnava subito la partita "in_corso" — esattamente
-- il comportamento da eliminare. Ridefinita come alias sicuro di
-- avvia_preparazione_match: se un punto del client non ancora
-- aggiornato la richiama, non salta più il gate esplicito di avvio.
create or replace function avvia_match(p_match_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select avvia_preparazione_match(p_match_id);
$$;

revoke execute on function avvia_match(uuid) from anon;
grant execute on function avvia_match(uuid) to authenticated;
