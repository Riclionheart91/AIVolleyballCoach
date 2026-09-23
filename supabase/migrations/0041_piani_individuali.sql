-- 0041 — Piani individuali (F6)

create table if not exists piani_individuali (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes on delete cascade,
  titolo text not null,
  obiettivo text not null default '',
  fondamentale_target text check (fondamentale_target in ('Servizio','Ricezione','Attacco','Muro','Difesa')),
  data_inizio date not null default current_date,
  data_fine date,
  stato text not null default 'attivo' check (stato in ('attivo','concluso','sospeso')),
  note text not null default '',
  creato_il timestamptz not null default now(),
  creato_da uuid references auth.users on delete set null
);

create index if not exists idx_piani_individuali_atleta on piani_individuali (athlete_id, stato);

create table if not exists piano_individuale_esercizi (
  id uuid primary key default gen_random_uuid(),
  piano_id uuid not null references piani_individuali on delete cascade,
  exercise_id uuid references exercises on delete set null,
  nome_libero text,
  indicazioni text not null default '',
  volte_a_settimana integer not null default 2 check (volte_a_settimana between 1 and 7),
  durata_minuti integer,
  ordine integer not null default 0,
  quando text not null default 'riscaldamento' check (quando in ('riscaldamento','tecnico','autonomo')),
  check (exercise_id is not null or nome_libero is not null)
);

create table if not exists piano_individuale_svolgimenti (
  id uuid primary key default gen_random_uuid(),
  piano_esercizio_id uuid not null references piano_individuale_esercizi on delete cascade,
  data date not null default current_date,
  registrato_da uuid references auth.users on delete set null,
  unique (piano_esercizio_id, data)
);

alter table piani_individuali enable row level security;
alter table piano_individuale_esercizi enable row level security;
alter table piano_individuale_svolgimenti enable row level security;

drop policy if exists "piani_individuali_select" on piani_individuali;
create policy "piani_individuali_select" on piani_individuali for select using (
  is_team_staff_visione_piena((select team_id from athletes where id = athlete_id))
  or athlete_id = mio_atleta_id((select team_id from athletes where id = athlete_id))
  or is_superuser()
);
drop policy if exists "piani_individuali_write_coach" on piani_individuali;
create policy "piani_individuali_write_coach" on piani_individuali for all using (
  is_team_coach((select team_id from athletes where id = athlete_id))
) with check (is_team_coach((select team_id from athletes where id = athlete_id)));

drop policy if exists "piano_esercizi_select" on piano_individuale_esercizi;
create policy "piano_esercizi_select" on piano_individuale_esercizi for select using (
  exists (select 1 from piani_individuali p where p.id = piano_id)
);
drop policy if exists "piano_esercizi_write_coach" on piano_individuale_esercizi;
create policy "piano_esercizi_write_coach" on piano_individuale_esercizi for all using (
  is_team_coach((select a.team_id from piani_individuali p join athletes a on a.id = p.athlete_id where p.id = piano_id))
) with check (
  is_team_coach((select a.team_id from piani_individuali p join athletes a on a.id = p.athlete_id where p.id = piano_id))
);

drop policy if exists "svolgimenti_select" on piano_individuale_svolgimenti;
create policy "svolgimenti_select" on piano_individuale_svolgimenti for select using (
  exists (select 1 from piano_individuale_esercizi pe where pe.id = piano_esercizio_id)
);
drop policy if exists "svolgimenti_write" on piano_individuale_svolgimenti;
create policy "svolgimenti_write" on piano_individuale_svolgimenti for all using (
  exists (
    select 1 from piano_individuale_esercizi pe
    join piani_individuali p on p.id = pe.piano_id
    join athletes a on a.id = p.athlete_id
    where pe.id = piano_esercizio_id
      and (is_team_coach(a.team_id) or p.athlete_id = mio_atleta_id(a.team_id))
  )
) with check (
  exists (
    select 1 from piano_individuale_esercizi pe
    join piani_individuali p on p.id = pe.piano_id
    join athletes a on a.id = p.athlete_id
    where pe.id = piano_esercizio_id
      and (is_team_coach(a.team_id) or p.athlete_id = mio_atleta_id(a.team_id))
  )
);

create or replace function elenca_piani_individuali(p_athlete_id uuid)
returns table(
  id uuid, titolo text, obiettivo text, fondamentale_target text,
  data_inizio date, data_fine date, stato text,
  numero_esercizi integer, svolgimenti_settimana integer, attesi_settimana integer
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from athletes where id = p_athlete_id;
  if v_team_id is null then raise exception 'Persona non trovata in anagrafica'; end if;
  if not (is_team_staff_visione_piena(v_team_id) or p_athlete_id = mio_atleta_id(v_team_id) or is_superuser()) then
    raise exception 'Permesso negato';
  end if;

  return query
  select p.id, p.titolo, p.obiettivo, p.fondamentale_target,
         p.data_inizio, p.data_fine, p.stato,
         (select count(*)::integer from piano_individuale_esercizi pe where pe.piano_id = p.id),
         (select count(*)::integer from piano_individuale_esercizi pe
            join piano_individuale_svolgimenti sv on sv.piano_esercizio_id = pe.id
           where pe.piano_id = p.id and sv.data >= current_date - 7),
         (select coalesce(sum(pe.volte_a_settimana), 0)::integer from piano_individuale_esercizi pe where pe.piano_id = p.id)
  from piani_individuali p
  where p.athlete_id = p_athlete_id
  order by (p.stato = 'attivo') desc, p.data_inizio desc;
end;
$$;

revoke all on function elenca_piani_individuali(uuid) from public, anon;
grant execute on function elenca_piani_individuali(uuid) to authenticated, service_role;
