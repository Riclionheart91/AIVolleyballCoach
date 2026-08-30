-- ============================================================
-- F3 — Scouting live (partite, set, eventi)
-- Occupa lo slot "0003" lasciato libero fin dall'inizio della
-- migrazione. Sostituisce Scouting.gs + ScoutingAtleta.gs +
-- ScoutingAdvanced.gs con UN SOLO modello dati (match_events) a
-- granularità variabile — invece di tre moduli/tre statistiche quasi
-- identiche, come discusso nel piano di migrazione originale.
--
-- Principi applicati (dallo stesso piano):
-- - un evento = un tap su fondamentale + un tap su esito (max 2 tap);
-- - il punteggio del set si aggiorna DA SOLO via trigger quando si
--   registra un evento, e si corregge da solo quando si annulla
--   l'ultimo evento — chi usa l'app non gestisce mai il punteggio a
--   mano, è una conseguenza degli eventi registrati;
-- - "annulla ultima azione" è semplicemente cancellare l'ultima riga:
--   nessuna logica di compensazione lato client, la fa il trigger;
-- - privacy: gli scout sono personali per l'atleta (vede solo i propri,
--   mai quelli delle compagne), pienamente visibili a
--   allenatore/vice/presidente — stessa regola già in vigore per
--   valutazioni/presenze/RPE (0001c_ruoli_estesi.sql), qui replicata
--   1:1 sulle stesse funzioni helper.
-- ============================================================

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  avversario text not null,
  data timestamptz not null,
  luogo text not null default 'casa' check (luogo in ('casa', 'trasferta')),
  stato text not null default 'programmata' check (stato in ('programmata', 'in_corso', 'conclusa')),
  set_vinti_noi integer not null default 0,
  set_vinti_avversario integer not null default 0,
  creato_il timestamptz not null default now(),
  creato_da uuid references auth.users on delete set null
);

create table if not exists match_sets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches on delete cascade,
  numero_set integer not null,
  punti_noi integer not null default 0,
  punti_avversario integer not null default 0,
  concluso boolean not null default false,
  unique (match_id, numero_set)
);

-- Un solo motore per tutti e tre i vecchi moduli scouting: athlete_id
-- nullo = scouting "a livello squadra" (come il vecchio Scouting.gs V1),
-- valorizzato = scouting per singola atleta (come ScoutingAtleta V1.5).
-- Il livello "avanzato" (ScoutingAdvanced, zone/rotazioni) resta un
-- possibile ampliamento additivo futuro di questa stessa tabella
-- (nuove colonne nullable), non un modulo separato.
create table if not exists match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches on delete cascade,
  set_id uuid not null references match_sets on delete cascade,
  skill text not null check (skill in ('Servizio', 'Ricezione', 'Attacco', 'Muro', 'Difesa', 'Punto_avversario')),
  esito text check (esito in ('punto', 'neutro', 'errore')),
  athlete_id uuid references athletes on delete set null,
  creato_il timestamptz not null default now(),
  creato_da uuid references auth.users on delete set null,
  -- "Punto_avversario" non ha bisogno di un esito (è già di per sé un
  -- punto avversario); ogni altro fondamentale lo richiede sempre.
  constraint match_events_esito_coerente check (
    (skill = 'Punto_avversario' and esito is null) or (skill <> 'Punto_avversario' and esito is not null)
  )
);

create index if not exists idx_matches_team on matches (team_id, data desc);
create index if not exists idx_match_sets_match on match_sets (match_id, numero_set);
create index if not exists idx_match_events_match on match_events (match_id, creato_il desc);
create index if not exists idx_match_events_athlete on match_events (athlete_id);

-- 1. Trigger: il punteggio del set è una CONSEGUENZA degli eventi, non
-- un dato inserito a mano — così "annulla ultima azione" è solo un
-- DELETE, mai una correzione manuale del punteggio.
create or replace function aggiorna_punteggio_da_evento()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.skill = 'Punto_avversario' or NEW.esito = 'errore' then
      update match_sets set punti_avversario = punti_avversario + 1 where id = NEW.set_id;
    elsif NEW.esito = 'punto' then
      update match_sets set punti_noi = punti_noi + 1 where id = NEW.set_id;
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    if OLD.skill = 'Punto_avversario' or OLD.esito = 'errore' then
      update match_sets set punti_avversario = greatest(0, punti_avversario - 1) where id = OLD.set_id;
    elsif OLD.esito = 'punto' then
      update match_sets set punti_noi = greatest(0, punti_noi - 1) where id = OLD.set_id;
    end if;
    return OLD;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_aggiorna_punteggio on match_events;
create trigger trg_aggiorna_punteggio
  after insert or delete on match_events
  for each row execute function aggiorna_punteggio_da_evento();

-- 2. RLS -------------------------------------------------------------
alter table matches enable row level security;
alter table match_sets enable row level security;
alter table match_events enable row level security;

drop policy if exists "matches_select_member" on matches;
create policy "matches_select_member" on matches for select using (is_team_member(team_id));
drop policy if exists "matches_write_coach" on matches;
create policy "matches_write_coach" on matches for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

drop policy if exists "match_sets_select_member" on match_sets;
create policy "match_sets_select_member" on match_sets for select using (
  is_team_member((select team_id from matches where id = match_id))
);
drop policy if exists "match_sets_write_coach" on match_sets;
create policy "match_sets_write_coach" on match_sets for all using (
  is_team_coach((select team_id from matches where id = match_id))
) with check (
  is_team_coach((select team_id from matches where id = match_id))
);

-- Scouting: personale per l'atleta, pieno per lo staff — stessa regola
-- di evaluations/attendance/rpe. Nessuna policy insert/delete diretta
-- per il client: si passa sempre dalle RPC qui sotto (registra_evento/
-- annulla_ultimo_evento), che verificano il permesso esplicitamente —
-- così il trigger di punteggio scatta sempre in modo coerente e nessuno
-- può inserire un evento "silenzioso" scrivendo direttamente sulla
-- tabella.
drop policy if exists "match_events_select_ristretta" on match_events;
create policy "match_events_select_ristretta" on match_events for select using (
  is_team_staff_visione_piena((select team_id from matches where id = match_id))
  or athlete_id = mio_atleta_id((select team_id from matches where id = match_id))
);

-- 3. RPC di gestione partita ------------------------------------------

create or replace function crea_match(p_team_id uuid, p_avversario text, p_data timestamptz, p_luogo text default 'casa')
returns uuid
language plpgsql
security definer
as $$
declare
  v_match_id uuid;
begin
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;

  insert into matches (team_id, avversario, data, luogo, stato)
  values (p_team_id, p_avversario, p_data, p_luogo, 'in_corso')
  returning id into v_match_id;

  insert into match_sets (match_id, numero_set) values (v_match_id, 1);

  return v_match_id;
end;
$$;

create or replace function nuovo_set(p_match_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_prossimo_numero integer;
  v_set_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update match_sets set concluso = true where match_id = p_match_id and concluso = false;

  select coalesce(max(numero_set), 0) + 1 into v_prossimo_numero from match_sets where match_id = p_match_id;
  insert into match_sets (match_id, numero_set) values (p_match_id, v_prossimo_numero) returning id into v_set_id;

  return v_set_id;
end;
$$;

-- Un tap (skill) + un tap (esito) = una chiamata sola: il client li
-- unisce prima di chiamare questa funzione, non sono due round-trip.
create or replace function registra_evento(p_match_id uuid, p_set_id uuid, p_skill text, p_esito text, p_athlete_id uuid default null)
returns uuid
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_evento_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  insert into match_events (match_id, set_id, skill, esito, athlete_id, creato_da)
  values (p_match_id, p_set_id, p_skill, p_esito, p_athlete_id, auth.uid())
  returning id into v_evento_id;

  return v_evento_id;
end;
$$;

-- "Annulla ultima azione": elimina l'evento più recente di QUESTA
-- partita (non solo di questo set, per coprire il caso raro di essersi
-- accorti dell'errore subito dopo aver cambiato set).
create or replace function annulla_ultimo_evento(p_match_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_evento_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  select id into v_evento_id from match_events where match_id = p_match_id order by creato_il desc limit 1;
  if v_evento_id is null then raise exception 'Nessun evento da annullare'; end if;

  delete from match_events where id = v_evento_id;
end;
$$;

create or replace function chiudi_match(p_match_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update match_sets set concluso = true where match_id = p_match_id and concluso = false;
  update matches set
    stato = 'conclusa',
    set_vinti_noi = (select count(*) from match_sets where match_id = p_match_id and punti_noi > punti_avversario),
    set_vinti_avversario = (select count(*) from match_sets where match_id = p_match_id and punti_avversario > punti_noi)
  where id = p_match_id;
end;
$$;

-- 4. Andamento squadra tra partite diverse — visibile a TUTTI (incluse
-- le atlete), mai scomposto per singola compagna: stesso principio già
-- applicato in andamento_squadra_valutazioni.
create or replace function andamento_squadra_partite(p_team_id uuid)
returns table(fondamentale text, partita date, avversario text, punti integer, errori integer)
language plpgsql
stable
security definer
as $$
begin
  if not is_team_member(p_team_id) then raise exception 'Permesso negato'; end if;

  return query
    select e.skill as fondamentale, m.data::date as partita, m.avversario,
           count(*) filter (where e.esito = 'punto')::integer as punti,
           count(*) filter (where e.esito = 'errore')::integer as errori
    from match_events e
    join matches m on m.id = e.match_id
    where m.team_id = p_team_id and e.skill <> 'Punto_avversario'
    group by e.skill, m.data, m.avversario
    order by m.data desc, e.skill;
end;
$$;
