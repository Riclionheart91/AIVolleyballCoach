-- 0018 — Piano annuale a blocchi (periodizzazione strutturata)
-- Vedi commento esteso nella migrazione applicata: struttura la
-- stagione in blocchi datati con tipo e obiettivi, invece del solo
-- testo libero. Il testo libero resta per le note generali.

create table if not exists blocchi_piano (
  id uuid primary key default gen_random_uuid(),
  piano_id uuid not null references piani_annuali on delete cascade,
  nome text not null,
  tipo text not null default 'preparazione_generale'
    check (tipo in ('preparazione_generale','preparazione_specifica','pre_competitiva','competitiva','scarico','transizione')),
  data_inizio date not null,
  data_fine date not null,
  obiettivi_tecnici text not null default '',
  obiettivi_fisici text not null default '',
  obiettivi_tattici text not null default '',
  note text not null default '',
  creato_il timestamptz not null default now(),
  check (data_fine >= data_inizio)
);

create index if not exists idx_blocchi_piano_piano_data on blocchi_piano (piano_id, data_inizio);
alter table blocchi_piano enable row level security;

drop policy if exists "blocchi_piano_select_member" on blocchi_piano;
create policy "blocchi_piano_select_member" on blocchi_piano for select using (
  is_team_member((select team_id from piani_annuali where id = piano_id)) or is_superuser()
);
drop policy if exists "blocchi_piano_write_coach" on blocchi_piano;
create policy "blocchi_piano_write_coach" on blocchi_piano for all using (
  is_team_coach((select team_id from piani_annuali where id = piano_id))
) with check (
  is_team_coach((select team_id from piani_annuali where id = piano_id))
);

create or replace function riepilogo_blocchi_piano(p_piano_id uuid)
returns table(blocco_id uuid, partite_nel_periodo integer, allenamenti_nel_periodo integer)
language sql stable security definer set search_path = public
as $$
  select b.id,
    (select count(*)::integer from matches m where m.team_id = pa.team_id and m.data::date between b.data_inizio and b.data_fine),
    (select count(*)::integer from trainings t where t.team_id = pa.team_id and t.data::date between b.data_inizio and b.data_fine)
  from blocchi_piano b join piani_annuali pa on pa.id = b.piano_id
  where b.piano_id = p_piano_id;
$$;

revoke execute on function riepilogo_blocchi_piano(uuid) from anon;
grant execute on function riepilogo_blocchi_piano(uuid) to authenticated;

create or replace function blocco_per_data(p_team_id uuid, p_data date)
returns table(nome text, tipo text, obiettivi_tecnici text, obiettivi_fisici text, obiettivi_tattici text)
language sql stable security definer set search_path = public
as $$
  select b.nome, b.tipo, b.obiettivi_tecnici, b.obiettivi_fisici, b.obiettivi_tattici
  from blocchi_piano b join piani_annuali pa on pa.id = b.piano_id
  where pa.team_id = p_team_id and p_data between b.data_inizio and b.data_fine and is_team_member(p_team_id)
  order by b.data_inizio desc limit 1;
$$;

revoke execute on function blocco_per_data(uuid, date) from anon;
grant execute on function blocco_per_data(uuid, date) to authenticated;
