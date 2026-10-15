-- Time-out registrati durante la partita, andamento dei giocatori tra le
-- ultime partite, e time-out nello stato letto dallo scout ospite.

-- ---------------------------------------------------------------------------
-- 1. Time-out: uno per riga, col punteggio al momento della chiamata
-- ---------------------------------------------------------------------------
create table if not exists match_timeouts (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  set_id uuid not null references match_sets(id) on delete cascade,
  squadra text not null check (squadra in ('noi', 'avversario')),
  punti_noi integer not null,
  punti_avversario integer not null,
  creato_il timestamptz not null default now(),
  creato_da uuid default auth.uid()
);

create index if not exists match_timeouts_match_idx on match_timeouts (match_id);
create index if not exists match_timeouts_set_idx on match_timeouts (set_id);

alter table match_timeouts enable row level security;

-- Lettura: chi fa parte della squadra (o il superuser). Nessuna policy di
-- scrittura: si scrive solo con le funzioni qui sotto.
drop policy if exists "match_timeouts_select_membri" on match_timeouts;
create policy "match_timeouts_select_membri" on match_timeouts for select using (
  is_superuser() or is_team_member((select m.team_id from matches m where m.id = match_id))
);

revoke all on match_timeouts from anon;
revoke insert, update, delete on match_timeouts from authenticated;
grant select on match_timeouts to authenticated;

-- Aggiornamento in tempo reale della schermata live (se la pubblicazione non
-- esiste o il tavolo e' gia' dentro, si prosegue senza errore).
do $$
begin
  alter publication supabase_realtime add table match_timeouts;
exception when others then
  raise notice 'Pubblicazione realtime non aggiornata per match_timeouts: %', sqlerrm;
end;
$$;

create or replace function registra_timeout(p_set_id uuid, p_squadra text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_team_id uuid;
  v_stato text;
  v_noi integer;
  v_avv integer;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if p_squadra not in ('noi', 'avversario') then raise exception 'Squadra non valida'; end if;

  select ms.match_id, m.team_id, m.stato, ms.punti_noi, ms.punti_avversario
    into v_match_id, v_team_id, v_stato, v_noi, v_avv
  from match_sets ms join matches m on m.id = ms.match_id
  where ms.id = p_set_id;
  if v_match_id is null then raise exception 'Set non trovato'; end if;

  if not (is_team_scout(v_team_id) or is_scout_ospite(v_match_id)) then raise exception 'Permesso negato'; end if;
  if v_stato <> 'in_corso' then raise exception 'La partita non e'' in corso'; end if;

  insert into match_timeouts (match_id, set_id, squadra, punti_noi, punti_avversario)
  values (v_match_id, p_set_id, p_squadra, v_noi, v_avv)
  returning id into v_id;
  return v_id;
end;
$$;

-- Toglie l'ultimo time-out del set (errore di tocco).
create or replace function annulla_ultimo_timeout(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_team_id uuid;
  v_stato text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select ms.match_id, m.team_id, m.stato into v_match_id, v_team_id, v_stato
  from match_sets ms join matches m on m.id = ms.match_id
  where ms.id = p_set_id;
  if v_match_id is null then raise exception 'Set non trovato'; end if;

  if not (is_team_scout(v_team_id) or is_scout_ospite(v_match_id)) then raise exception 'Permesso negato'; end if;
  if v_stato <> 'in_corso' then raise exception 'La partita non e'' in corso'; end if;

  delete from match_timeouts
  where id = (select t.id from match_timeouts t where t.set_id = p_set_id order by t.creato_il desc limit 1);
end;
$$;

revoke execute on function registra_timeout(uuid, text) from public, anon;
revoke execute on function annulla_ultimo_timeout(uuid) from public, anon;
grant execute on function registra_timeout(uuid, text) to authenticated;
grant execute on function annulla_ultimo_timeout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Andamento di ciascun giocatore nelle ultime partite
--    (stessa visibilita' dell'analisi per persona: staff e scout vedono tutti,
--    un'atleta vede solo se stessa)
-- ---------------------------------------------------------------------------
create or replace function andamento_persone_partite(p_team_id uuid, p_ultime integer default 5)
returns table (
  athlete_id uuid,
  match_id uuid,
  data timestamptz,
  avversario text,
  fondamentale text,
  azioni integer,
  punti integer,
  errori integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mio uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  v_mio := mio_atleta_id(p_team_id);
  if not (is_team_staff_visione_piena(p_team_id) or is_team_scout(p_team_id) or v_mio is not null) then
    raise exception 'Permesso negato';
  end if;

  return query
  select me.athlete_id, mm.id, mm.data, mm.avversario, me.skill,
         count(*)::integer,
         (count(*) filter (where me.esito = 'punto'))::integer,
         (count(*) filter (where me.esito = 'errore'))::integer
  from (
    select m2.id, m2.data, m2.avversario
    from matches m2
    where m2.team_id = p_team_id and m2.stato in ('in_corso', 'conclusa')
    order by m2.data desc
    limit greatest(coalesce(p_ultime, 5), 1)
  ) mm
  join match_events me on me.match_id = mm.id
  where me.athlete_id is not null
    and (is_team_staff_visione_piena(p_team_id) or is_team_scout(p_team_id) or me.athlete_id = v_mio)
  group by me.athlete_id, mm.id, mm.data, mm.avversario, me.skill
  order by mm.data, me.athlete_id;
end;
$$;

revoke execute on function andamento_persone_partite(uuid, integer) from public, anon;
grant execute on function andamento_persone_partite(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Lo stato letto dallo scout ospite ora comprende i time-out
--    (stessa funzione della 0068, con una chiave in piu')
-- ---------------------------------------------------------------------------
create or replace function scout_ospite_stato_partita(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_set_id uuid;
  v_camp uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_scout_ospite(p_match_id) then raise exception 'Permesso negato'; end if;

  select team_id, campionato_id into v_team_id, v_camp from matches where id = p_match_id;

  select id into v_set_id from match_sets
  where match_id = p_match_id and not concluso
  order by numero_set limit 1;
  if v_set_id is null then
    select id into v_set_id from match_sets
    where match_id = p_match_id
    order by numero_set desc limit 1;
  end if;

  return jsonb_build_object(
    'match', (select to_jsonb(m) - 'sporteasy_uid' - 'creato_da' - 'luogo' from matches m where m.id = p_match_id),
    'team_nome', (select t.nome from teams t where t.id = v_team_id),
    'set_attivo_id', v_set_id,
    'sets', coalesce((select jsonb_agg(to_jsonb(s) order by s.numero_set) from match_sets s where s.match_id = p_match_id), '[]'::jsonb),
    'eventi', coalesce((
      select jsonb_agg(to_jsonb(x) - 'creato_da' order by x.creato_il desc)
      from (select * from match_events where match_id = p_match_id order by creato_il desc limit 20) x
    ), '[]'::jsonb),
    'atlete', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'team_id', a.team_id, 'nome', a.nome, 'cognome', a.cognome,
        'numero_maglia', a.numero_maglia, 'ruolo_campo', a.ruolo_campo
      ) order by a.cognome)
      from match_convocati c join athletes a on a.id = c.athlete_id
      where c.match_id = p_match_id
    ), '[]'::jsonb),
    'convocati', coalesce((
      select jsonb_agg(jsonb_build_object('athlete_id', c.athlete_id, 'is_libero', c.is_libero))
      from match_convocati c where c.match_id = p_match_id
    ), '[]'::jsonb),
    'formazione', case when v_set_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(to_jsonb(l)) from match_set_lineups l where l.set_id = v_set_id
    ), '[]'::jsonb) end,
    'libero', case when v_set_id is null then null else (
      select to_jsonb(x) from libero_in_campo(v_set_id) x limit 1
    ) end,
    'timeouts', coalesce((
      select jsonb_agg(to_jsonb(t) - 'creato_da' order by t.creato_il)
      from match_timeouts t where t.match_id = p_match_id
    ), '[]'::jsonb),
    'regole', (
      select jsonb_build_object('puntiPerSet', coalesce(c.punti_per_set, 25), 'puntiSetDecisivo', coalesce(c.punti_set_decisivo, 15))
      from (select 1) d left join campionati c on c.id = v_camp
    )
  );
end;
$$;

revoke execute on function scout_ospite_stato_partita(uuid) from public, anon;
grant execute on function scout_ospite_stato_partita(uuid) to authenticated;
