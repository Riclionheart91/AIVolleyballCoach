-- 0039 — F4: analisi partita ricca

create or replace function analisi_fondamentali_partita(p_match_id uuid)
returns table(
  fondamentale text, azioni integer, punti integer, errori integer,
  efficienza numeric, quota_sul_totale integer
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_totale integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id)) then raise exception 'Permesso negato'; end if;

  select count(*) into v_totale from match_events
  where match_id = p_match_id and skill not in ('Punto_avversario','Punto_nostro','Fallo_rotazione');

  return query
  select
    me.skill,
    count(*)::integer,
    count(*) filter (where me.esito = 'punto')::integer,
    count(*) filter (where me.esito = 'errore')::integer,
    round((count(*) filter (where me.esito = 'punto') - count(*) filter (where me.esito = 'errore'))::numeric
          / nullif(count(*), 0), 2),
    round(100.0 * count(*) / nullif(v_totale, 0))::integer
  from match_events me
  where me.match_id = p_match_id
    and me.skill not in ('Punto_avversario','Punto_nostro','Fallo_rotazione')
  group by me.skill
  order by count(*) desc;
end;
$$;

create or replace function analisi_persone_partita(p_match_id uuid)
returns table(
  athlete_id uuid, nome_completo text, azioni integer, punti integer, errori integer,
  saldo integer, fondamentale_migliore text, fondamentale_peggiore text
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_mio uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  v_mio := mio_atleta_id(v_team_id);
  if not (is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id) or v_mio is not null) then
    raise exception 'Permesso negato';
  end if;

  return query
  with per_persona_skill as (
    select me.athlete_id as aid, me.skill,
           (count(*) filter (where me.esito = 'punto') - count(*) filter (where me.esito = 'errore'))::integer as saldo_skill
    from match_events me
    where me.match_id = p_match_id and me.athlete_id is not null
    group by me.athlete_id, me.skill
  ),
  totali as (
    select me.athlete_id as aid,
           count(*)::integer as n,
           count(*) filter (where me.esito = 'punto')::integer as p,
           count(*) filter (where me.esito = 'errore')::integer as e
    from match_events me
    where me.match_id = p_match_id and me.athlete_id is not null
    group by me.athlete_id
  )
  select
    t.aid,
    a.nome || ' ' || a.cognome,
    t.n, t.p, t.e, (t.p - t.e)::integer,
    (select s.skill from per_persona_skill s where s.aid = t.aid order by s.saldo_skill desc limit 1),
    (select s.skill from per_persona_skill s where s.aid = t.aid order by s.saldo_skill asc limit 1)
  from totali t
  join athletes a on a.id = t.aid
  where is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id) or t.aid = v_mio
  order by (t.p - t.e) desc;
end;
$$;

create or replace function andamento_tra_partite(p_team_id uuid, p_quante integer default 10)
returns table(
  match_id uuid, avversario text, data date, set_vinti_noi integer, set_vinti_avversario integer,
  azioni integer, punti integer, errori integer, efficienza numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_staff_visione_piena(p_team_id) then raise exception 'Permesso negato'; end if;

  return query
  select
    m.id, m.avversario, m.data::date, m.set_vinti_noi, m.set_vinti_avversario,
    count(me.id)::integer,
    count(*) filter (where me.esito = 'punto' or me.skill = 'Punto_nostro')::integer,
    count(*) filter (where me.esito = 'errore' or me.skill in ('Punto_avversario','Fallo_rotazione'))::integer,
    round((count(*) filter (where me.esito = 'punto' or me.skill = 'Punto_nostro')
           - count(*) filter (where me.esito = 'errore' or me.skill in ('Punto_avversario','Fallo_rotazione')))::numeric
          / nullif(count(me.id), 0), 2)
  from matches m
  left join match_events me on me.match_id = m.id
  where m.team_id = p_team_id and m.stato = 'conclusa'
  group by m.id, m.avversario, m.data, m.set_vinti_noi, m.set_vinti_avversario
  order by m.data desc
  limit greatest(1, p_quante);
end;
$$;

revoke all on function analisi_fondamentali_partita(uuid) from public, anon;
revoke all on function analisi_persone_partita(uuid) from public, anon;
revoke all on function andamento_tra_partite(uuid, integer) from public, anon;
grant execute on function analisi_fondamentali_partita(uuid) to authenticated, service_role;
grant execute on function analisi_persone_partita(uuid) to authenticated, service_role;
grant execute on function andamento_tra_partite(uuid, integer) to authenticated, service_role;
