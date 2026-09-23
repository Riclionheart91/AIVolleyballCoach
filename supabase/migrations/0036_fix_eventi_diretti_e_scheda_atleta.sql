-- 0036 — Tre correzioni bloccanti
--
-- BUG 1: rotazione_applicata poteva risultare NULL quando esito era
-- NULL (in SQL "NULL or false" fa NULL, non false), violando il
-- vincolo NOT NULL della colonna.
-- BUG 2: il vincolo pretende esito NULL per Punto_nostro/
-- Punto_avversario/Fallo_rotazione; ora è la funzione a forzarlo.
-- BUG 3: "column reference fondamentale is ambiguous" nella scheda
-- atleta, per omonimia tra parametro di uscita e colonna.

create or replace function cattura_stato_servizio()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_servizio_attuale text;
  v_punto_nostro boolean;
begin
  select squadra_al_servizio, turno_servizio_corrente
    into v_servizio_attuale, NEW.turno_servizio
  from match_sets where id = NEW.set_id;

  NEW.servizio_precedente := v_servizio_attuale;

  select athlete_id into NEW.rotazione_al_servizio
  from match_set_lineups
  where set_id = NEW.set_id and posizione = 1 and in_campo = true;

  v_punto_nostro := coalesce(NEW.esito = 'punto', false) or NEW.skill = 'Punto_nostro';
  NEW.rotazione_applicata := coalesce(v_punto_nostro and v_servizio_attuale is distinct from 'noi', false);

  return NEW;
end;
$$;

create or replace function registra_evento(p_match_id uuid, p_set_id uuid, p_skill text, p_esito text, p_athlete_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_stato_match text;
  v_evento_id uuid;
  v_esito text;
  v_athlete uuid;
  v_posizione integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select team_id, stato into v_team_id, v_stato_match from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;
  if v_stato_match = 'conclusa' then raise exception 'Partita già conclusa'; end if;
  if v_stato_match <> 'in_corso' then raise exception 'La partita non è ancora iniziata'; end if;

  if not exists (select 1 from match_sets where id = p_set_id and match_id = p_match_id for update) then
    raise exception 'Il set indicato non appartiene a questa partita';
  end if;
  if not exists (select 1 from match_set_lineups where set_id = p_set_id) then
    raise exception 'Formazione non impostata per questo set';
  end if;

  if p_skill in ('Punto_avversario','Punto_nostro','Fallo_rotazione') then
    v_esito := null;
    v_athlete := null;
  else
    v_esito := p_esito;
    v_athlete := p_athlete_id;
    if v_esito is null then raise exception 'Indica l''esito dell''azione'; end if;

    if v_athlete is not null then
      if not exists (select 1 from athletes where id = v_athlete and team_id = v_team_id) then
        raise exception 'Questa persona non fa parte della squadra';
      end if;
      if p_skill = 'Servizio' then
        select posizione into v_posizione from match_set_lineups
        where set_id = p_set_id and athlete_id = v_athlete and in_campo = true;
        if v_posizione is distinct from 1 then
          raise exception 'Il servizio può essere attribuito solo a chi si trova in posizione 1 (zona di battuta)';
        end if;
      end if;
    end if;
  end if;

  insert into match_events (match_id, set_id, skill, esito, athlete_id, creato_da)
  values (p_match_id, p_set_id, p_skill, v_esito, v_athlete, auth.uid())
  returning id into v_evento_id;

  return v_evento_id;
end;
$$;

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
