-- Memoria delle scelte di classificazione SportEasy: quando la
-- sincronizzazione trova un titolo di evento mai visto per questa
-- squadra, l'allenatore lo classifica a mano (allenamento/partita/
-- ignora) dal pannello di sincronizzazione. La scelta resta legata al
-- TITOLO ESATTO (normalizzato) e alla squadra — ogni squadra ha il suo
-- calendario, quindi anche la sua memoria di classificazione, mai
-- condivisa tra squadre diverse — così le sincronizzazioni successive
-- con lo stesso titolo si applicano da sole, senza richiedere di
-- nuovo la scelta.
create table if not exists sporteasy_classificazioni (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  chiave_titolo text not null,
  tipo text not null check (tipo in ('allenamento', 'partita', 'evento')),
  creato_il timestamptz not null default now(),
  unique (team_id, chiave_titolo)
);

alter table sporteasy_classificazioni enable row level security;
drop policy if exists "sporteasy_classificazioni_select_member" on sporteasy_classificazioni;
create policy "sporteasy_classificazioni_select_member" on sporteasy_classificazioni for select using (is_team_member(team_id));
drop policy if exists "sporteasy_classificazioni_write_coach" on sporteasy_classificazioni;
create policy "sporteasy_classificazioni_write_coach" on sporteasy_classificazioni for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));
