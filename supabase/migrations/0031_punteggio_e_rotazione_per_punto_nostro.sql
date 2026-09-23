-- 0031 — "Punto_nostro" nel punteggio e nella rotazione

create or replace function aggiorna_punteggio_da_evento()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.skill = 'Punto_avversario' or NEW.esito = 'errore' then
      update match_sets set punti_avversario = punti_avversario + 1 where id = NEW.set_id;
    elsif NEW.skill = 'Punto_nostro' or NEW.esito = 'punto' then
      update match_sets set punti_noi = punti_noi + 1 where id = NEW.set_id;
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    if OLD.skill = 'Punto_avversario' or OLD.esito = 'errore' then
      update match_sets set punti_avversario = greatest(0, punti_avversario - 1) where id = OLD.set_id;
    elsif OLD.skill = 'Punto_nostro' or OLD.esito = 'punto' then
      update match_sets set punti_noi = greatest(0, punti_noi - 1) where id = OLD.set_id;
    end if;
    return OLD;
  end if;
  return null;
end;
$$;

create or replace function cattura_stato_servizio()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_servizio_attuale text;
  v_punto_nostro boolean;
begin
  select squadra_al_servizio into v_servizio_attuale from match_sets where id = NEW.set_id;
  NEW.servizio_precedente := v_servizio_attuale;

  select athlete_id into NEW.rotazione_al_servizio
  from match_set_lineups
  where set_id = NEW.set_id and posizione = 1 and in_campo = true;

  v_punto_nostro := (NEW.esito = 'punto' or NEW.skill = 'Punto_nostro');
  NEW.rotazione_applicata := v_punto_nostro and v_servizio_attuale is distinct from 'noi';

  return NEW;
end;
$$;

create or replace function applica_rotazione_dopo_evento()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_punto_avversario boolean;
begin
  v_punto_avversario := (NEW.skill = 'Punto_avversario' or NEW.esito = 'errore');

  if NEW.rotazione_applicata then
    perform ruota_formazione(NEW.set_id);
    update match_sets set squadra_al_servizio = 'noi' where id = NEW.set_id;
  elsif v_punto_avversario and NEW.servizio_precedente is distinct from 'avversario' then
    update match_sets set squadra_al_servizio = 'avversario' where id = NEW.set_id;
  end if;

  return NEW;
end;
$$;

create or replace function rendimento_rotazioni_partita(p_match_id uuid)
returns table(rotazione_di text, punti_fatti integer, errori_commessi integer, saldo integer, azioni_totali integer)
language plpgsql stable security definer set search_path = public
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id)) then raise exception 'Permesso negato'; end if;

  return query
  select
    coalesce(a.cognome, 'rotazione non registrata'),
    count(*) filter (where me.esito = 'punto' or me.skill = 'Punto_nostro')::integer,
    count(*) filter (where me.esito = 'errore' or me.skill = 'Punto_avversario')::integer,
    (count(*) filter (where me.esito = 'punto' or me.skill = 'Punto_nostro')
     - count(*) filter (where me.esito = 'errore' or me.skill = 'Punto_avversario'))::integer,
    count(*)::integer
  from match_events me
  left join athletes a on a.id = me.rotazione_al_servizio
  where me.match_id = p_match_id
  group by a.cognome
  order by 4 asc;
end;
$$;
