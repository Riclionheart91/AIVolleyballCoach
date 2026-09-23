-- 0034 — Turni di servizio + fallo di rotazione

alter table match_events drop constraint if exists match_events_skill_check;
alter table match_events add constraint match_events_skill_check
  check (skill in ('Servizio','Ricezione','Attacco','Muro','Difesa','Punto_avversario','Punto_nostro','Fallo_rotazione'));

alter table match_sets add column if not exists turno_servizio_corrente integer not null default 1;
alter table match_events add column if not exists turno_servizio integer;

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

  v_punto_nostro := ((NEW.esito = 'punto' or NEW.skill = 'Punto_nostro') and NEW.skill <> 'Fallo_rotazione');
  NEW.rotazione_applicata := v_punto_nostro and v_servizio_attuale is distinct from 'noi';

  return NEW;
end;
$$;

create or replace function aggiorna_punteggio_da_evento()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.skill in ('Punto_avversario','Fallo_rotazione') or NEW.esito = 'errore' then
      update match_sets set punti_avversario = punti_avversario + 1 where id = NEW.set_id;
    elsif NEW.skill = 'Punto_nostro' or NEW.esito = 'punto' then
      update match_sets set punti_noi = punti_noi + 1 where id = NEW.set_id;
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    if OLD.skill in ('Punto_avversario','Fallo_rotazione') or OLD.esito = 'errore' then
      update match_sets set punti_avversario = greatest(0, punti_avversario - 1) where id = OLD.set_id;
    elsif OLD.skill = 'Punto_nostro' or OLD.esito = 'punto' then
      update match_sets set punti_noi = greatest(0, punti_noi - 1) where id = OLD.set_id;
    end if;
    return OLD;
  end if;
  return null;
end;
$$;

create or replace function applica_rotazione_dopo_evento()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_punto_avversario boolean;
begin
  v_punto_avversario := (NEW.skill in ('Punto_avversario','Fallo_rotazione') or NEW.esito = 'errore');

  if NEW.rotazione_applicata then
    perform ruota_formazione(NEW.set_id);
    update match_sets
      set squadra_al_servizio = 'noi', turno_servizio_corrente = turno_servizio_corrente + 1
      where id = NEW.set_id;
  elsif v_punto_avversario and NEW.servizio_precedente is distinct from 'avversario' then
    update match_sets
      set squadra_al_servizio = 'avversario', turno_servizio_corrente = turno_servizio_corrente + 1
      where id = NEW.set_id;
  end if;

  return NEW;
end;
$$;

create or replace function rendimento_turni_servizio(p_match_id uuid)
returns table(
  al_servizio text, turni_giocati integer, punti_nel_turno integer,
  punti_subiti_nel_turno integer, media_punti_per_turno numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id)) then raise exception 'Permesso negato'; end if;

  return query
  with nostri as (
    select me.*, coalesce(a.cognome, 'non registrata') as servitrice
    from match_events me
    left join athletes a on a.id = me.rotazione_al_servizio
    where me.match_id = p_match_id
      and me.servizio_precedente = 'noi'
      and me.turno_servizio is not null
  )
  select
    n.servitrice,
    count(distinct n.turno_servizio)::integer,
    count(*) filter (where n.esito = 'punto' or n.skill = 'Punto_nostro')::integer,
    count(*) filter (where n.esito = 'errore' or n.skill in ('Punto_avversario','Fallo_rotazione'))::integer,
    round(
      count(*) filter (where n.esito = 'punto' or n.skill = 'Punto_nostro')::numeric
      / nullif(count(distinct n.turno_servizio), 0), 2)
  from nostri n
  group by n.servitrice
  order by 5 desc nulls last;
end;
$$;

create or replace function verifica_formazione(p_set_id uuid)
returns table(avviso text, gravita text)
language plpgsql stable security definer set search_path = public
as $$
declare v_team_id uuid; v_match_id uuid;
begin
  select m.id, m.team_id into v_match_id, v_team_id
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;

  return query
  select
    format('%s è indicata come Libero ma si trova in posizione %s: il Libero gioca solo in seconda linea (5, 6, 1) e non può servire.',
           a.cognome, l.posizione),
    'attenzione'
  from match_set_lineups l
  join athletes a on a.id = l.athlete_id
  join match_convocati c on c.match_id = v_match_id and c.athlete_id = l.athlete_id
  where l.set_id = p_set_id and l.in_campo = true and c.is_libero = true
    and l.posizione in (1, 2, 3, 4);
end;
$$;

revoke all on function rendimento_turni_servizio(uuid) from public, anon;
revoke all on function verifica_formazione(uuid) from public, anon;
grant execute on function rendimento_turni_servizio(uuid) to authenticated, service_role;
grant execute on function verifica_formazione(uuid) to authenticated, service_role;
