-- ============================================================
-- 0004 — Integrazione SportEasy (sync eventi calendario)
-- Occupa lo slot "0004" lasciato libero per F6. Sostituisce
-- SportEasySync.gs: importa SOLO eventi (allenamenti/partite) dal
-- calendario iCal della squadra, mai l'anagrafica atlete (come da
-- richiesta esplicita).
--
-- Design: la sincronizzazione vera (fetch HTTP + parsing ICS) vive
-- nell'Edge Function `sync-sporteasy`, che scrive qui con la
-- service_role key dopo aver verificato is_team_coach() — stesso
-- pattern già usato per ai-router. Qui in SQL c'è solo: dove si
-- salva l'URL del calendario, e come evitare eventi duplicati ad
-- ogni sincronizzazione (sporteasy_uid, l'identificativo univoco che
-- ogni evento ha già dentro il file .ics).
-- ============================================================

create table if not exists team_integrations (
  team_id uuid primary key references teams on delete cascade,
  sporteasy_ical_url text,
  ultima_sincronizzazione timestamptz,
  ultimo_esito text
);

alter table team_integrations enable row level security;
drop policy if exists "team_integrations_select_member" on team_integrations;
create policy "team_integrations_select_member" on team_integrations for select using (is_team_member(team_id));
drop policy if exists "team_integrations_write_coach" on team_integrations;
create policy "team_integrations_write_coach" on team_integrations for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

-- Dedup: un evento con lo stesso UID (dal file .ics) non viene mai
-- duplicato, anche sincronizzando cento volte — viene solo aggiornato
-- (titolo/data), mai lo stato che l'allenatore ha già cambiato in app
-- (vedi Edge Function: l'UPSERT non tocca mai "stato").
alter table trainings add column if not exists sporteasy_uid text;
create unique index if not exists idx_trainings_sporteasy_uid on trainings (team_id, sporteasy_uid) where sporteasy_uid is not null;

alter table matches add column if not exists sporteasy_uid text;
create unique index if not exists idx_matches_sporteasy_uid on matches (team_id, sporteasy_uid) where sporteasy_uid is not null;

create or replace function imposta_integrazione_sporteasy(p_team_id uuid, p_ical_url text)
returns void
language plpgsql
security definer
as $$
begin
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;

  insert into team_integrations (team_id, sporteasy_ical_url)
  values (p_team_id, p_ical_url)
  on conflict (team_id) do update set sporteasy_ical_url = excluded.sporteasy_ical_url;
end;
$$;

-- Un evento importato dal calendario nasce come partita "programmata"
-- SENZA set (non ha senso creare un set finché non si comincia a
-- scoutare davvero). avvia_match crea il set 1 e la porta "in_corso"
-- solo quando l'allenatore preme "Inizia scouting" il giorno stesso.
create or replace function avvia_match(p_match_id uuid)
returns uuid
language plpgsql
security definer
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

  update matches set stato = 'in_corso' where id = p_match_id and stato = 'programmata';

  return v_set_id;
end;
$$;
