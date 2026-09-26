-- ============================================================
-- 0055 — Modello stagione a livello di società (fase schema)
--
-- Confermato con l'utente: le stagioni diventano un'unica entità
-- condivisa da tutta la società (non più una per squadra). Le 3 righe
-- oggi esistenti (PEACH GATE, Orange, WHITE — tutte "2026/2027") vengono
-- consolidate in una sola, quella di PEACH GATE (la più vecchia, aperta
-- il 2/9), che diventa l'unica stagione della società Gate Volley
-- Milano. Le altre due righe vengono rimosse dopo aver spostato ciò che
-- vi era collegato (1 piano annuale di Orange).
--
-- Nuova tabella team_stagioni_attivazioni: la presenza di una riga
-- (team_id, season_id) significa "il presidente ha confermato questa
-- squadra per questa stagione" — è così che si realizza "nessuno deve
-- poter ancora accedere alla nuova stagione finché il presidente non
-- riassegna gli allenatori". Confermato con l'utente: la regola vale
-- SEMPRE, senza eccezioni per la primissima stagione — quindi anche
-- PEACH GATE e Orange (già in uso oggi) restano sospese dopo questa
-- migrazione, finché il presidente non le riattiva esplicitamente da
-- Gestione società.
-- ============================================================

drop policy if exists seasons_select_member on seasons;
drop policy if exists seasons_write_presidente_insert on seasons;
drop policy if exists seasons_write_presidente_update on seasons;
drop policy if exists seasons_write_presidente_delete on seasons;
drop policy if exists season_baselines_write_coach_insert on season_baselines;
drop policy if exists season_baselines_write_coach_update on season_baselines;
drop policy if exists season_baselines_write_coach_delete on season_baselines;
drop policy if exists season_baselines_select_unificata on season_baselines;

alter table seasons add column societa_id uuid references societa(id) on delete cascade;
update seasons s set societa_id = t.societa_id from teams t where t.id = s.team_id;

update piani_annuali set season_id = 'b29ba059-6f11-495c-9558-e8aa3826bd1d'
  where season_id in ('be2ca47d-cc0e-447a-9634-3a0644c8a427', '28afffdb-2654-4112-8012-dc5e3318135d');
update season_baselines set season_id = 'b29ba059-6f11-495c-9558-e8aa3826bd1d'
  where season_id in ('be2ca47d-cc0e-447a-9634-3a0644c8a427', '28afffdb-2654-4112-8012-dc5e3318135d');

delete from seasons where id in ('be2ca47d-cc0e-447a-9634-3a0644c8a427', '28afffdb-2654-4112-8012-dc5e3318135d');

alter table seasons drop column team_id;
alter table seasons alter column societa_id set not null;

create unique index idx_una_stagione_attiva_per_societa on seasons (societa_id) where stato = 'attiva';

create table team_stagioni_attivazioni (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  attivata_il timestamptz not null default now(),
  attivata_da uuid references auth.users(id) on delete set null,
  unique (team_id, season_id)
);

alter table team_stagioni_attivazioni enable row level security;

create policy team_stagioni_attivazioni_select on team_stagioni_attivazioni
  for select using (is_team_member(team_id) or is_team_presidente(team_id) or is_superuser());
create policy team_stagioni_attivazioni_insert on team_stagioni_attivazioni
  for insert with check (is_team_presidente(team_id));
create policy team_stagioni_attivazioni_delete on team_stagioni_attivazioni
  for delete using (is_team_presidente(team_id));

create policy seasons_select_member on seasons
  for select using (
    is_superuser()
    or is_societa_presidente(societa_id)
    or exists (select 1 from teams t where t.societa_id = seasons.societa_id and is_team_member(t.id))
  );
create policy seasons_write_presidente_insert on seasons
  for insert with check (is_societa_presidente(societa_id));
create policy seasons_write_presidente_update on seasons
  for update using (is_societa_presidente(societa_id)) with check (is_societa_presidente(societa_id));
create policy seasons_write_presidente_delete on seasons
  for delete using (is_societa_presidente(societa_id));

create policy season_baselines_write_coach_insert on season_baselines
  for insert with check (is_team_coach((select team_id from athletes where id = season_baselines.athlete_id)));
create policy season_baselines_write_coach_update on season_baselines
  for update
  using (is_team_coach((select team_id from athletes where id = season_baselines.athlete_id)))
  with check (is_team_coach((select team_id from athletes where id = season_baselines.athlete_id)));
create policy season_baselines_write_coach_delete on season_baselines
  for delete using (is_team_coach((select team_id from athletes where id = season_baselines.athlete_id)));
create policy season_baselines_select_unificata on season_baselines
  for select using (
    is_superuser()
    or is_team_staff_visione_piena((select team_id from athletes where id = season_baselines.athlete_id))
    or athlete_id = mio_atleta_id((select team_id from athletes where id = season_baselines.athlete_id))
  );

create or replace function verifica_stesso_team_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_societa_stagione uuid;
  v_societa_atleta uuid;
begin
  select societa_id into v_societa_stagione from seasons where id = NEW.season_id;
  select t.societa_id into v_societa_atleta from athletes a join teams t on t.id = a.team_id where a.id = NEW.athlete_id;
  if v_societa_stagione is distinct from v_societa_atleta then
    raise exception 'L''atleta non appartiene alla società di questa stagione';
  end if;
  return NEW;
end;
$$;
