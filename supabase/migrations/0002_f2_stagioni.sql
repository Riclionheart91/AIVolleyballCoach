-- ============================================================
-- F2 — Stagioni + baseline (equivalente di V2.5 in AIVolleyballCoach GAS)
-- Nessuna colonna toccata su evaluations: l'appartenenza di una
-- valutazione a una stagione resta calcolata per intervallo di date,
-- esattamente come in storicoStagionale() (Seasons.gs originale) —
-- stessa scelta di design, portata qui pari pari.
-- ============================================================

create table if not exists seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  nome text not null,
  stato text not null default 'pianificata' check (stato in ('pianificata', 'attiva', 'conclusa')),
  data_apertura date not null,
  data_chiusura date,
  creata_il timestamptz not null default now(),
  creata_da uuid references auth.users on delete set null
);

-- Una sola stagione "attiva" per team alla volta (era STAGIONE_ATTIVA_ID
-- nelle Script Properties: qui è un vincolo dichiarativo nel DB, niente
-- più stato nascosto fuori dalle tabelle che può disallinearsi).
create unique index if not exists idx_seasons_una_attiva_per_team
  on seasons (team_id) where (stato = 'attiva');

create table if not exists season_baselines (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons on delete cascade,
  athlete_id uuid not null references athletes on delete cascade,
  fondamentale text not null check (fondamentale in ('Battuta', 'Ricezione', 'Attacco', 'Muro', 'Difesa')),
  valore_baseline numeric(3,1) not null,
  valutazione_id_riferimento uuid references evaluations on delete set null,
  creata_il timestamptz not null default now(),
  creata_da uuid references auth.users on delete set null,
  unique (season_id, athlete_id, fondamentale)
);

create index if not exists idx_seasons_team on seasons (team_id, data_apertura desc);
create index if not exists idx_season_baselines_season on season_baselines (season_id);
create index if not exists idx_season_baselines_athlete on season_baselines (athlete_id);

alter table seasons enable row level security;
alter table season_baselines enable row level security;

drop policy if exists "seasons_select_member" on seasons;
create policy "seasons_select_member" on seasons for select using (is_team_member(team_id));
drop policy if exists "seasons_write_coach" on seasons;
create policy "seasons_write_coach" on seasons for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

drop policy if exists "season_baselines_select_member" on season_baselines;
create policy "season_baselines_select_member" on season_baselines for select using (
  is_team_member((select team_id from seasons where id = season_id))
);
drop policy if exists "season_baselines_write_coach" on season_baselines;
create policy "season_baselines_write_coach" on season_baselines for all using (
  is_team_coach((select team_id from seasons where id = season_id))
) with check (
  is_team_coach((select team_id from seasons where id = season_id))
);

-- Attiva una stagione disattivando automaticamente le altre dello stesso
-- team (equivalente di attivaStagione() in Seasons.gs), in un'unica
-- transazione: evita la race condition possibile nella versione GAS tra
-- il ciclo di "disattiva le altre" e "attiva questa".
create or replace function attiva_stagione(p_season_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from seasons where id = p_season_id;
  if v_team_id is null then
    raise exception 'Stagione non trovata: %', p_season_id;
  end if;
  if not is_team_coach(v_team_id) then
    raise exception 'Permesso negato';
  end if;

  update seasons set stato = 'pianificata' where team_id = v_team_id and stato = 'attiva' and id <> p_season_id;
  update seasons set stato = 'attiva' where id = p_season_id;
end;
$$;

-- Genera la baseline di inizio stagione per tutte le atlete attive
-- (equivalente di generaBaselineStagione() in Seasons.gs). Idempotente:
-- salta atleta/fondamentale già presenti per quella stagione.
create or replace function genera_baseline_stagione(p_season_id uuid)
returns integer
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_data_apertura date;
  v_creati integer := 0;
  v_fondamentale text;
  v_riferimento record;
begin
  select team_id, data_apertura into v_team_id, v_data_apertura from seasons where id = p_season_id;
  if v_team_id is null then raise exception 'Stagione non trovata: %', p_season_id; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  for v_fondamentale in select unnest(array['Battuta','Ricezione','Attacco','Muro','Difesa'])
  loop
    for v_riferimento in
      select distinct on (e.athlete_id) e.athlete_id, e.id as valutazione_id, e.punteggio
      from evaluations e
      join athletes a on a.id = e.athlete_id
      where e.fondamentale = v_fondamentale
        and a.team_id = v_team_id
        and a.status = 'attiva'
        and e.data_valutazione::date <= v_data_apertura
        and not exists (
          select 1 from season_baselines sb
          where sb.season_id = p_season_id and sb.athlete_id = e.athlete_id and sb.fondamentale = v_fondamentale
        )
      order by e.athlete_id, e.data_valutazione desc
    loop
      insert into season_baselines (season_id, athlete_id, fondamentale, valore_baseline, valutazione_id_riferimento, creata_da)
      values (p_season_id, v_riferimento.athlete_id, v_fondamentale, v_riferimento.punteggio, v_riferimento.valutazione_id, auth.uid());
      v_creati := v_creati + 1;
    end loop;
  end loop;

  return v_creati;
end;
$$;
