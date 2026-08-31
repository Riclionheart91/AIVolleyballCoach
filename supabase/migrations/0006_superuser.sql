-- ============================================================
-- 0006 — Super-amministratore globale
--
-- Un superuser non appartiene a un team: è registrato in app_admins e
-- vede/gestisce trasversalmente tutte le squadre. Pensato per un ruolo
-- di gestione tecnica della piattaforma (es. te), non per il normale
-- staff di una squadra — un allenatore/presidente restano scoperti
-- entro il proprio team con le regole già in vigore.
--
-- Applicato qui alle tabelle principali (teams, team_members, athletes,
-- evaluations, seasons, matches, match_events, ai_providers_config
-- globale). Le tabelle rimaste fuori da questa prima passata (exercises,
-- trainings, training_exercises, attendance, rpe, evaluation_proposals,
-- season_baselines, team_invites, team_integrations, ai_call_log)
-- seguono lo stesso identico pattern — un "or is_superuser()" aggiunto
-- alla USING della policy di select — da estendere quando serve
-- davvero vedere anche quei dati da superuser, non è stato fatto qui
-- solo per contenere la dimensione di questa migrazione.
-- ============================================================

create table if not exists app_admins (
  user_id uuid primary key references auth.users on delete cascade,
  aggiunto_il timestamptz not null default now()
);

alter table app_admins enable row level security;
-- Nessuna policy di select/insert per il client: solo un altro
-- superuser può leggerla, e comunque solo tramite is_superuser() che è
-- security definer (bypassa la RLS). L'unico modo per aggiungere un
-- nuovo superuser è dal SQL Editor di Supabase direttamente:
--   insert into app_admins (user_id) values ('uuid-utente');
-- Scelta intenzionale: promuovere qualcuno a superuser non deve essere
-- possibile dall'app stessa, nemmeno da un altro superuser via RPC.

create or replace function is_superuser()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

-- RPC usata dal client solo per sapere se mostrare le voci di menu da
-- superuser — non concede nulla di per sé, la vera protezione è nelle
-- policy RLS qui sotto.
create or replace function sono_superuser()
returns boolean
language sql stable
as $$
  select is_superuser();
$$;

-- Estende (mai sostituisce) le policy di select già esistenti.
drop policy if exists "teams_select_member" on teams;
create policy "teams_select_member" on teams for select using (is_team_member(id) or is_superuser());

drop policy if exists "team_members_select_same_team" on team_members;
create policy "team_members_select_same_team" on team_members for select using (is_team_member(team_id) or is_superuser());

drop policy if exists "athletes_select_member" on athletes;
create policy "athletes_select_member" on athletes for select using (is_team_member(team_id) or is_superuser());

drop policy if exists "evaluations_select_ristretta" on evaluations;
create policy "evaluations_select_ristretta" on evaluations for select using (
  is_team_staff_visione_piena(team_id) or athlete_id = mio_atleta_id(team_id) or is_superuser()
);

drop policy if exists "seasons_select_member" on seasons;
create policy "seasons_select_member" on seasons for select using (is_team_member(team_id) or is_superuser());

drop policy if exists "matches_select_member" on matches;
create policy "matches_select_member" on matches for select using (is_team_member(team_id) or is_superuser());

drop policy if exists "match_events_select_ristretta" on match_events;
create policy "match_events_select_ristretta" on match_events for select using (
  is_team_staff_visione_piena((select team_id from matches where id = match_id))
  or athlete_id = mio_atleta_id((select team_id from matches where id = match_id))
  or is_superuser()
);

-- ai_providers_config: il superuser può gestire i default GLOBALI
-- (team_id is null) — le righe specifiche di un singolo team restano
-- decisione di quel team, il superuser non le tocca da qui.
drop policy if exists "ai_providers_config_write_coach" on ai_providers_config;
create policy "ai_providers_config_write_coach" on ai_providers_config for all using (
  (team_id is not null and is_team_coach(team_id)) or (team_id is null and is_superuser())
) with check (
  (team_id is not null and is_team_coach(team_id)) or (team_id is null and is_superuser())
);
