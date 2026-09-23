-- 0033 — Scheda atleta: obiettivi personali e record

create table if not exists obiettivi_atleta (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes on delete cascade,
  fondamentale text not null check (fondamentale in ('Servizio','Ricezione','Attacco','Muro','Difesa')),
  valore_obiettivo numeric(3,1) not null check (valore_obiettivo between 1 and 10),
  entro_data date,
  note text not null default '',
  raggiunto_il date,
  creato_il timestamptz not null default now(),
  creato_da uuid references auth.users on delete set null,
  unique (athlete_id, fondamentale)
);

alter table obiettivi_atleta enable row level security;

drop policy if exists "obiettivi_atleta_select" on obiettivi_atleta;
create policy "obiettivi_atleta_select" on obiettivi_atleta for select using (
  is_team_staff_visione_piena((select team_id from athletes where id = athlete_id))
  or athlete_id = mio_atleta_id((select team_id from athletes where id = athlete_id))
  or is_superuser()
);

drop policy if exists "obiettivi_atleta_write_coach" on obiettivi_atleta;
create policy "obiettivi_atleta_write_coach" on obiettivi_atleta for all using (
  is_team_coach((select team_id from athletes where id = athlete_id))
) with check (is_team_coach((select team_id from athletes where id = athlete_id)));

create or replace function scheda_atleta(p_athlete_id uuid)
returns table(
  fondamentale text, valore_attuale numeric, data_attuale date,
  valore_precedente numeric, variazione numeric,
  record_personale numeric, data_record date, e_record_adesso boolean,
  obiettivo numeric, entro_data date, progresso_percentuale integer, numero_valutazioni integer
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from athletes where id = p_athlete_id;
  if v_team_id is null then raise exception 'Persona non trovata'; end if;
  if not (is_team_staff_visione_piena(v_team_id) or p_athlete_id = mio_atleta_id(v_team_id) or is_superuser()) then
    raise exception 'Permesso negato';
  end if;

  return query
  with elenco(nome_f) as (
    values ('Servizio'), ('Ricezione'), ('Attacco'), ('Muro'), ('Difesa')
  ),
  ordinate as (
    select e.fondamentale as f, e.punteggio as p, e.data_valutazione as d,
           row_number() over (partition by e.fondamentale order by e.data_valutazione desc) as rn
    from evaluations e where e.athlete_id = p_athlete_id
  ),
  ultime as (select f, p as attuale, d::date as data_att from ordinate where rn = 1),
  penultime as (select f, p as prec from ordinate where rn = 2),
  massimi as (
    select e.fondamentale as f, max(e.punteggio) as massimo,
           (array_agg(e.data_valutazione::date order by e.punteggio desc, e.data_valutazione desc))[1] as data_max
    from evaluations e where e.athlete_id = p_athlete_id group by e.fondamentale
  ),
  conteggi as (
    select e.fondamentale as f, count(*)::integer as n
    from evaluations e where e.athlete_id = p_athlete_id group by e.fondamentale
  )
  select
    el.nome_f, u.attuale, u.data_att, pe.prec,
    case when u.attuale is not null and pe.prec is not null then round(u.attuale - pe.prec, 1) end,
    ma.massimo, ma.data_max,
    coalesce(u.attuale is not null and ma.massimo is not null
             and u.attuale >= ma.massimo and u.data_att = ma.data_max, false),
    ob.valore_obiettivo, ob.entro_data,
    case when ob.valore_obiettivo is null or u.attuale is null then null
         when u.attuale >= ob.valore_obiettivo then 100
         else greatest(0, round(100.0 * u.attuale / ob.valore_obiettivo))::integer end,
    coalesce(co.n, 0)
  from elenco el
  left join ultime u on u.f = el.nome_f
  left join penultime pe on pe.f = el.nome_f
  left join massimi ma on ma.f = el.nome_f
  left join conteggi co on co.f = el.nome_f
  left join obiettivi_atleta ob on ob.athlete_id = p_athlete_id and ob.fondamentale = el.nome_f;
end;
$$;

create or replace function imposta_obiettivo_atleta(p_athlete_id uuid, p_fondamentale text, p_valore numeric, p_entro date default null, p_note text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from athletes where id = p_athlete_id;
  if v_team_id is null then raise exception 'Atleta non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  insert into obiettivi_atleta (athlete_id, fondamentale, valore_obiettivo, entro_data, note, creato_da)
  values (p_athlete_id, p_fondamentale, p_valore, p_entro, coalesce(p_note, ''), auth.uid())
  on conflict (athlete_id, fondamentale) do update
    set valore_obiettivo = excluded.valore_obiettivo,
        entro_data = excluded.entro_data,
        note = excluded.note;
end;
$$;

create or replace function rimuovi_obiettivo_atleta(p_athlete_id uuid, p_fondamentale text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_team_id uuid;
begin
  select team_id into v_team_id from athletes where id = p_athlete_id;
  if v_team_id is null then raise exception 'Atleta non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;
  delete from obiettivi_atleta where athlete_id = p_athlete_id and fondamentale = p_fondamentale;
end;
$$;

revoke all on function scheda_atleta(uuid) from public, anon;
revoke all on function imposta_obiettivo_atleta(uuid, text, numeric, date, text) from public, anon;
revoke all on function rimuovi_obiettivo_atleta(uuid, text) from public, anon;
grant execute on function scheda_atleta(uuid) to authenticated, service_role;
grant execute on function imposta_obiettivo_atleta(uuid, text, numeric, date, text) to authenticated, service_role;
grant execute on function rimuovi_obiettivo_atleta(uuid, text) to authenticated, service_role;
